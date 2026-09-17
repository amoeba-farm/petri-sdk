use std::{env, fs, path::PathBuf, process::ExitCode};

use light_token_minter::governance_manifest::phase3_instruction_manifest_json;

fn checked_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/governance/generated/phase-3-instruction-manifest-v1.json")
}

fn run() -> Result<(), String> {
    let rendered = phase3_instruction_manifest_json();
    let argument = env::args().nth(1);
    match argument.as_deref() {
        None | Some("--stdout") => {
            print!("{rendered}");
            Ok(())
        }
        Some("--write") => {
            let path = checked_manifest_path();
            let parent = path
                .parent()
                .ok_or_else(|| "manifest path has no parent".to_owned())?;
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
            fs::write(&path, rendered)
                .map_err(|error| format!("failed to write {}: {error}", path.display()))?;
            println!("wrote {}", path.display());
            Ok(())
        }
        Some("--check") => {
            let path = checked_manifest_path();
            let checked = fs::read_to_string(&path)
                .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
            if checked != rendered {
                return Err(format!(
                    "{} has drifted; run `cargo run --example phase3_instruction_manifest -- --write`",
                    path.display()
                ));
            }
            println!("manifest is current: {}", path.display());
            Ok(())
        }
        Some(other) => Err(format!(
            "unknown argument {other:?}; use --stdout, --write, or --check"
        )),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
