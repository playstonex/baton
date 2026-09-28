use crate::protocol::Event;
use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{BufReader, Read, Write};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
    pid: u32,
}

impl PtySession {
    pub fn spawn(
        command: String,
        args: Vec<String>,
        cwd: String,
        env: Vec<(String, String)>,
        cols: u16,
        rows: u16,
        event_tx: Sender<Event>,
    ) -> Result<Self> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(&command);
        cmd.args(&args);
        cmd.cwd(&cwd);
        for (k, v) in &env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| anyhow!("Failed to spawn command: {}", e))?;

        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| anyhow!("Failed to clone PTY reader: {}", e))?;
        let writer = master
            .take_writer()
            .map_err(|e| anyhow!("Failed to take PTY writer: {}", e))?;

        let pid = child.process_id().unwrap_or(0);

        let event_tx_for_read = event_tx.clone();
        let _read_thread = thread::spawn(move || {
            let mut buf_reader = BufReader::new(reader);
            let mut byte_buf = [0u8; 8192];

            loop {
                match buf_reader.read(&mut byte_buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&byte_buf[..n]).to_string();
                        let _ = event_tx_for_read.send(Event::Output { data });
                    }
                    Err(_) => break,
                }
            }
        });

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let child_for_exit = Arc::clone(&child_arc);
        let _exit_thread = thread::spawn(move || {
            let status = {
                let mut guard = child_for_exit.lock().unwrap();
                if let Some(ref mut c) = *guard {
                    c.wait()
                } else {
                    return;
                }
            };
            match status {
                Ok(exit_status) => {
                    let code = exit_status.exit_code() as i32;
                    let _ = event_tx.send(Event::Exit { code, signal: None });
                }
                Err(e) => {
                    let _ = event_tx.send(Event::Error {
                        message: format!("Child wait failed: {}", e),
                    });
                }
            }
        });

        Ok(Self {
            master,
            writer: Arc::new(Mutex::new(writer)),
            child: child_arc,
            pid,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn write(&self, data: &str) -> Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer
            .write_all(data.as_bytes())
            .map_err(|e| anyhow!("Write failed: {}", e))?;
        writer
            .flush()
            .map_err(|e| anyhow!("Flush failed: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow!("Resize failed: {}", e))
    }

    pub fn kill(&self) -> Result<()> {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            child.kill().map_err(|e| anyhow!("Kill failed: {}", e))
        } else {
            Ok(())
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
        }
    }
}
