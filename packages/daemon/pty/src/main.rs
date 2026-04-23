mod protocol;
mod session;

use anyhow::Result;
use protocol::{Command, Event};
use session::PtySession;
use std::io::{BufRead, Write};
use std::sync::mpsc;

fn main() -> Result<()> {
    let stdin = std::io::stdin();

    let mut pty_session: Option<PtySession> = None;
    let (event_tx, event_rx) = mpsc::channel::<Event>();

    let (stdout_tx, stdout_rx) = mpsc::channel::<String>();
    let stdout_tx_main = stdout_tx.clone();

    let _stdout_thread = std::thread::spawn(move || {
        let mut out = std::io::stdout().lock();
        while let Ok(line) = stdout_rx.recv() {
            let _ = writeln!(out, "{}", line);
            let _ = out.flush();
        }
    });

    let _forward_thread = std::thread::spawn(move || {
        while let Ok(event) = event_rx.recv() {
            if let Ok(json) = serde_json::to_string(&event) {
                let _ = stdout_tx.send(json);
            }
            if matches!(event, Event::Exit { .. }) {
                break;
            }
        }
    });

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let cmd: Command = match serde_json::from_str(trimmed) {
            Ok(c) => c,
            Err(e) => {
                let _ = serde_json::to_string(&Event::Error {
                    message: format!("Invalid command: {}", e),
                })
                .map(|json| eprintln!("{}", json));
                continue;
            }
        };

        match cmd {
            Command::Spawn {
                command,
                args,
                cwd,
                env,
                cols,
                rows,
            } => {
                match PtySession::spawn(command, args, cwd, env, cols, rows, event_tx.clone()) {
                    Ok(session) => {
                        let pid = session.pid();
                        let json = serde_json::to_string(&Event::Ready { pid })?;
                        let _ = stdout_tx_main.send(json);
                        pty_session = Some(session);
                    }
                    Err(e) => {
                        let json = serde_json::to_string(&Event::Error {
                            message: format!("Spawn failed: {}", e),
                        })?;
                        let _ = stdout_tx_main.send(json);
                    }
                }
            }
            Command::Write { data } => {
                if let Some(session) = &pty_session {
                    if let Err(e) = session.write(&data) {
                        let json = serde_json::to_string(&Event::Error {
                            message: format!("Write failed: {}", e),
                        })?;
                        let _ = stdout_tx_main.send(json);
                    }
                }
            }
            Command::Resize { cols, rows } => {
                if let Some(session) = &pty_session {
                    if let Err(e) = session.resize(cols, rows) {
                        let json = serde_json::to_string(&Event::Error {
                            message: format!("Resize failed: {}", e),
                        })?;
                        let _ = stdout_tx_main.send(json);
                    }
                }
            }
            Command::Kill { signal: _ } => {
                if let Some(session) = &pty_session {
                    let _ = session.kill();
                }
            }
        }
    }

    if let Some(session) = pty_session.take() {
        let _ = session.kill();
    }

    Ok(())
}
