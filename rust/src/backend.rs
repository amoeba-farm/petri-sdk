use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, HeaderMap, HeaderName, HeaderValue};
use serde::Serialize;
use serde_json::{Map, Value};
use std::env;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::io::Read;
use std::net::IpAddr;
use std::time::Duration;

const REQUEST_TIMEOUT_SECONDS: u64 = 15;
const MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS_ENV: &str = "PETRI_BACKEND_TIMEOUT_MS";
const AMEBA_REQUEST_TIMEOUT_MS_ENV: &str = "AMEBA_BACKEND_TIMEOUT_MS";
pub const AMEBA_CLIENT_HEADER: &str = "x-ameba-client";
pub const PETRI_CLIENT_ID: &str = "petri-cli";
pub const SDK_CLIENT_ID: &str = "ameba-sdk";

#[derive(Debug)]
pub struct CliError {
    message: String,
}

impl CliError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: sanitize_display_text(&message.into()),
        }
    }
}

impl Display for CliError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl Error for CliError {}

pub struct BackendClient {
    base_url: String,
    http: Client,
}

impl BackendClient {
    /// Petri compatibility constructor. New SDK consumers should use
    /// [`BackendClient::for_sdk`] or [`BackendClient::with_client_id`].
    pub fn new(base_url: impl Into<String>) -> Result<Self, CliError> {
        Self::with_client_id(base_url, PETRI_CLIENT_ID)
    }

    pub fn for_sdk(base_url: impl Into<String>) -> Result<Self, CliError> {
        Self::with_client_id(base_url, SDK_CLIENT_ID)
    }

    pub fn with_client_id(
        base_url: impl Into<String>,
        client_id: impl AsRef<str>,
    ) -> Result<Self, CliError> {
        let base_url = validate_backend_url(&base_url.into())?;
        let client_id = client_id.as_ref().trim();
        if client_id.is_empty() {
            return Err(CliError::new("Amoeba client identity must not be empty"));
        }
        let http = Client::builder()
            .timeout(request_timeout())
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(client_id)
            .default_headers(default_headers(client_id)?)
            .build()
            .map_err(|error| CliError::new(format!("failed to build HTTP client: {error}")))?;

        Ok(Self { base_url, http })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn get(&self, path: &str) -> Result<Value, CliError> {
        let response = self
            .http
            .get(self.url(path))
            .send()
            .map_err(|error| CliError::new(format!("GET {path} failed: {error}")))?;

        decode_response(response, path)
    }

    pub fn post_json<T: Serialize>(&self, path: &str, payload: &T) -> Result<Value, CliError> {
        self.post_json_with_timeout(path, payload, request_timeout())
    }

    pub fn post_json_with_timeout<T: Serialize>(
        &self,
        path: &str,
        payload: &T,
        timeout: Duration,
    ) -> Result<Value, CliError> {
        let response = self
            .http
            .post(self.url(path))
            .json(payload)
            .timeout(timeout)
            .send()
            .map_err(|error| CliError::new(format!("POST {path} failed: {error}")))?;

        decode_response(response, path)
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }
}

fn default_headers(client_id: &str) -> Result<HeaderMap, CliError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static(AMEBA_CLIENT_HEADER),
        HeaderValue::from_str(client_id)
            .map_err(|_| CliError::new("Amoeba client identity is not a valid HTTP header"))?,
    );
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    Ok(headers)
}

fn normalize_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

fn validate_backend_url(raw: &str) -> Result<String, CliError> {
    let parsed = reqwest::Url::parse(raw.trim())
        .map_err(|_| CliError::new("Amoeba URL must be an absolute HTTP(S) URL"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| CliError::new("Amoeba URL must include a host"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(CliError::new("Amoeba URL must use http:// or https://"));
    }
    let normalized_host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let loopback = normalized_host.eq_ignore_ascii_case("localhost")
        || normalized_host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    if parsed.scheme() == "http" && !loopback {
        return Err(CliError::new(
            "Amoeba URL must use HTTPS (HTTP is allowed only for loopback development)",
        ));
    }
    if !loopback && normalized_host != "api.amoeba.farm" {
        return Err(CliError::new(
            "Amoeba URL must target api.amoeba.farm (or a loopback development server)",
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(CliError::new(
            "Amoeba URL must not contain username/password credentials",
        ));
    }
    if parsed.fragment().is_some() {
        return Err(CliError::new("Amoeba URL must not contain a fragment"));
    }
    if parsed.query().is_some() {
        return Err(CliError::new("Amoeba URL must not contain a query string"));
    }
    if parsed.path() != "/" {
        return Err(CliError::new(
            "Amoeba URL must be the API origin, without a path",
        ));
    }
    Ok(normalize_base_url(parsed.as_str()))
}

fn request_timeout() -> Duration {
    timeout_from_millis_env(
        env::var(REQUEST_TIMEOUT_MS_ENV)
            .ok()
            .or_else(|| env::var(AMEBA_REQUEST_TIMEOUT_MS_ENV).ok())
            .as_deref(),
    )
}

fn timeout_from_millis_env(raw: Option<&str>) -> Duration {
    raw.and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|millis| *millis > 0)
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
}

fn decode_response(response: Response, path: &str) -> Result<Value, CliError> {
    let status = response.status();
    let declared_length = response.content_length();
    let body_bytes = read_bounded(response, declared_length, path)?;
    let body = String::from_utf8_lossy(&body_bytes).into_owned();

    let parsed = serde_json::from_str::<Value>(&body).unwrap_or_else(|_| {
        let mut object = Map::new();
        object.insert("raw".to_string(), Value::String(body.clone()));
        Value::Object(object)
    });

    if !status.is_success() {
        let message = parsed
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                parsed
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("backend returned HTTP {status}"));
        return Err(CliError::new(format!("{message} ({path})")));
    }

    Ok(parsed)
}

fn read_bounded(
    reader: impl Read,
    declared_length: Option<u64>,
    path: &str,
) -> Result<Vec<u8>, CliError> {
    if declared_length.is_some_and(|length| length > MAX_RESPONSE_BYTES) {
        return Err(CliError::new(format!(
            "{path} response exceeds {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    let mut body = Vec::new();
    reader
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|error| CliError::new(format!("failed to read {path} response: {error}")))?;
    if body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(CliError::new(format!(
            "{path} response exceeds {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    Ok(body)
}

fn sanitize_display_text(input: &str) -> String {
    let mut output = String::new();
    for (index, character) in input.chars().enumerate() {
        if index >= 16_384 {
            output.push_str("...[truncated]");
            break;
        }
        match character {
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' => {
                output.push_str(&format!("\\u{{{:04x}}}", character as u32));
            }
            value if value.is_control() => {
                output.push_str(&format!("\\u{{{:04x}}}", value as u32));
            }
            value => output.push(value),
        }
    }
    output
}

pub fn json_string(value: &Value) -> Result<String, CliError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| CliError::new(format!("failed to format JSON output: {error}")))
}

pub fn value_at_key<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            return Some(found);
        }
    }
    None
}

pub fn string_at_key(value: &Value, keys: &[&str]) -> Option<String> {
    value_at_key(value, keys).and_then(|item| match item {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    })
}

pub fn array_at_key<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Vec<Value>> {
    value_at_key(value, keys).and_then(Value::as_array)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_env_keeps_default_when_missing_or_invalid() {
        assert_eq!(
            timeout_from_millis_env(None),
            Duration::from_secs(REQUEST_TIMEOUT_SECONDS)
        );
        assert_eq!(
            timeout_from_millis_env(Some("0")),
            Duration::from_secs(REQUEST_TIMEOUT_SECONDS)
        );
        assert_eq!(
            timeout_from_millis_env(Some("not-a-number")),
            Duration::from_secs(REQUEST_TIMEOUT_SECONDS)
        );
    }

    #[test]
    fn timeout_env_accepts_positive_milliseconds() {
        assert_eq!(
            timeout_from_millis_env(Some("2500")),
            Duration::from_millis(2500)
        );
    }

    #[test]
    fn backend_url_requires_https_except_for_loopback() {
        assert!(BackendClient::new("http://backend.example.test").is_err());
        assert!(BackendClient::new("https://backend.example.test").is_err());
        assert!(BackendClient::new("https://api.devnet.solana.com").is_err());
        assert!(BackendClient::new("https://devnet.helius-rpc.com").is_err());
        assert!(BackendClient::new("https://user:password@backend.example.test").is_err());
        assert!(BackendClient::new("http://127.0.0.1:4000").is_ok());
        assert!(BackendClient::new("http://[::1]:4000").is_ok());
        assert!(BackendClient::new("https://api.amoeba.farm").is_ok());
        assert!(BackendClient::for_sdk("https://api.amoeba.farm").is_ok());
        assert!(BackendClient::with_client_id("https://api.amoeba.farm", "").is_err());
        assert!(BackendClient::new("https://api.amoeba.farm?token=secret").is_err());
    }

    #[test]
    fn backend_text_is_terminal_safe() {
        let error = CliError::new("bad\u{1b}]0;owned\u{7}\nnext");
        let displayed = error.to_string();
        assert!(!displayed.contains('\u{1b}'));
        assert!(!displayed.contains('\u{7}'));
        assert!(!displayed.contains('\n'));
        assert!(displayed.contains("\\u{001b}"));
    }

    #[test]
    fn bounded_reader_rejects_declared_and_streamed_overflow() {
        assert!(
            read_bounded(
                std::io::Cursor::new(Vec::<u8>::new()),
                Some(MAX_RESPONSE_BYTES + 1),
                "/large"
            )
            .is_err()
        );
        assert!(
            read_bounded(
                std::io::Cursor::new(vec![0_u8; MAX_RESPONSE_BYTES as usize + 1]),
                None,
                "/large"
            )
            .is_err()
        );
    }
}
