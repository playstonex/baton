use crate::protocol::{CellUpdate, Event};
use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{BufReader, Read, Write};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use vte::{Params, Perform, Parser};

struct TerminalGrid {
    cols: u16,
    rows: u16,
    cells: Vec<Vec<CellData>>,
    cursor_row: u16,
    cursor_col: u16,
    dirty: Vec<(u16, u16)>,
    current_fg: Option<String>,
    current_bg: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
}

#[derive(Clone)]
struct CellData {
    text: String,
    fg: Option<String>,
    bg: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
}

impl TerminalGrid {
    fn new(cols: u16, rows: u16) -> Self {
        let cells = (0..rows).map(|_| (0..cols).map(|_| CellData::default()).collect()).collect();
        Self {
            cols,
            rows,
            cells,
            cursor_row: 0,
            cursor_col: 0,
            dirty: Vec::new(),
            current_fg: None,
            current_bg: None,
            bold: false,
            italic: false,
            underline: false,
        }
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        let new_cells: Vec<Vec<CellData>> = (0..rows)
            .map(|r| {
                (0..cols)
                    .map(|c| {
                        self.cells
                            .get(r as usize)
                            .and_then(|row| row.get(c as usize))
                            .cloned()
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .collect();
        self.cells = new_cells;
        self.cols = cols;
        self.rows = rows;
        self.cursor_row = self.cursor_row.min(rows.saturating_sub(1));
        self.cursor_col = self.cursor_col.min(cols.saturating_sub(1));
        self.dirty = (0..rows).flat_map(|r| (0..cols).map(move |c| (r, c))).collect();
    }

    fn put_char(&mut self, ch: char) {
        if self.cursor_col >= self.cols {
            self.cursor_col = 0;
            self.cursor_row += 1;
            if self.cursor_row >= self.rows {
                self.scroll_up();
                self.cursor_row = self.rows - 1;
            }
        }
        let r = self.cursor_row as usize;
        let c = self.cursor_col as usize;
        if r < self.cells.len() && c < self.cells[r].len() {
            self.cells[r][c] = CellData {
                text: ch.to_string(),
                fg: self.current_fg.clone(),
                bg: self.current_bg.clone(),
                bold: self.bold,
                italic: self.italic,
                underline: self.underline,
            };
            self.dirty.push((self.cursor_row, self.cursor_col));
        }
        self.cursor_col += 1;
    }

    fn scroll_up(&mut self) {
        self.cells.remove(0);
        self.cells.push((0..self.cols).map(|_| CellData::default()).collect());
        let rows = self.rows;
        let cols = self.cols;
        self.dirty = (0..rows).flat_map(|r| (0..cols).map(move |c| (r, c))).collect();
    }

    fn clear_row_from(&mut self, row: u16, start_col: u16) {
        let row_idx = row as usize;
        if row_idx >= self.cells.len() {
            return;
        }
        for c in start_col..self.cols {
            let c_idx = c as usize;
            if c_idx < self.cells[row_idx].len() {
                self.cells[row_idx][c_idx] = CellData::default();
                self.dirty.push((row, c));
            }
        }
    }

    fn clear_row_all(&mut self, row: u16) {
        self.clear_row_from(row, 0);
    }

    fn clear_screen(&mut self) {
        for r in 0..self.rows {
            for c in 0..self.cols {
                self.cells[r as usize][c as usize] = CellData::default();
                self.dirty.push((r, c));
            }
        }
    }

    fn drain_dirty(&mut self) -> Vec<CellUpdate> {
        self.dirty
            .drain(..)
            .map(|(r, c)| {
                let cell = &self.cells[r as usize][c as usize];
                CellUpdate {
                    row: r,
                    col: c,
                    text: cell.text.clone(),
                    fg: cell.fg.clone(),
                    bg: cell.bg.clone(),
                    bold: cell.bold,
                    italic: cell.italic,
                    underline: cell.underline,
                }
            })
            .collect()
    }
}

impl Default for CellData {
    fn default() -> Self {
        Self {
            text: String::from(" "),
            fg: None,
            bg: None,
            bold: false,
            italic: false,
            underline: false,
        }
    }
}

struct GridHandler {
    grid: Arc<Mutex<TerminalGrid>>,
}

impl Perform for GridHandler {
    fn print(&mut self, c: char) {
        let mut grid = self.grid.lock().unwrap();
        grid.put_char(c);
    }

    fn execute(&mut self, byte: u8) {
        let mut grid = self.grid.lock().unwrap();
        match byte {
            0x0A => {
                grid.cursor_row += 1;
                if grid.cursor_row >= grid.rows {
                    grid.scroll_up();
                    grid.cursor_row = grid.rows - 1;
                }
            }
            0x0D => {
                grid.cursor_col = 0;
            }
            0x08 => {
                if grid.cursor_col > 0 {
                    grid.cursor_col -= 1;
                }
            }
            0x09 => {
                let next_tab = ((grid.cursor_col / 8) + 1) * 8;
                grid.cursor_col = next_tab.min(grid.cols - 1);
            }
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &Params, _intermediates: &[u8], _ignore: bool, action: char) {
        let mut grid = self.grid.lock().unwrap();
        let params_vec: Vec<u16> = params.iter().map(|p| p[0] as u16).collect();

        match action {
            'A' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1);
                grid.cursor_row = grid.cursor_row.saturating_sub(n);
            }
            'B' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1);
                grid.cursor_row = (grid.cursor_row + n).min(grid.rows - 1);
            }
            'C' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1);
                grid.cursor_col = (grid.cursor_col + n).min(grid.cols - 1);
            }
            'D' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1);
                grid.cursor_col = grid.cursor_col.saturating_sub(n);
            }
            'H' | 'f' => {
                let row = params_vec.first().copied().unwrap_or(1).max(1);
                let col = params_vec.get(1).copied().unwrap_or(1).max(1);
                grid.cursor_row = (row - 1).min(grid.rows.saturating_sub(1));
                grid.cursor_col = (col - 1).min(grid.cols.saturating_sub(1));
            }
            'J' => {
                let mode = params_vec.first().copied().unwrap_or(0);
                let row = grid.cursor_row;
                let col = grid.cursor_col;
                match mode {
                    0 => grid.clear_row_from(row, col),
                    2 => grid.clear_screen(),
                    _ => {}
                }
            }
            'K' => {
                let mode = params_vec.first().copied().unwrap_or(0);
                let row = grid.cursor_row;
                let col = grid.cursor_col;
                match mode {
                    0 => grid.clear_row_from(row, col),
                    2 => grid.clear_row_all(row),
                    _ => {}
                }
            }
            'm' => {
                if params_vec.is_empty() || params_vec[0] == 0 {
                    grid.current_fg = None;
                    grid.current_bg = None;
                    grid.bold = false;
                    grid.italic = false;
                    grid.underline = false;
                } else {
                    for &p in &params_vec {
                        match p {
                            0 => {
                                grid.current_fg = None;
                                grid.current_bg = None;
                                grid.bold = false;
                                grid.italic = false;
                                grid.underline = false;
                            }
                            1 => grid.bold = true,
                            3 => grid.italic = true,
                            4 => grid.underline = true,
                            30..=37 => {
                                grid.current_fg = Some(ansi_color_to_hex(p - 30));
                            }
                            40..=47 => {
                                grid.current_bg = Some(ansi_color_to_hex(p - 40));
                            }
                            39 => grid.current_fg = None,
                            49 => grid.current_bg = None,
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_terminated: bool) {}
    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _action: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
}

fn ansi_color_to_hex(idx: u16) -> String {
    let colors = [
        "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
        "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    colors.get(idx as usize).unwrap_or(&"#ffffff").to_string()
}

pub struct PtySession {
    grid: Arc<Mutex<TerminalGrid>>,
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

        let grid = Arc::new(Mutex::new(TerminalGrid::new(cols, rows)));
        let grid_for_read = Arc::clone(&grid);
        let event_tx_for_read = event_tx.clone();

        let pid = child.process_id().unwrap_or(0);

        let _read_thread = thread::spawn(move || {
            let mut parser = Parser::new();
            let mut handler = GridHandler {
                grid: grid_for_read,
            };

            let mut buf_reader = BufReader::new(reader);
            let mut output_buf = Vec::new();
            let mut byte_buf = [0u8; 4096];

            loop {
                match buf_reader.read(&mut byte_buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        output_buf.extend_from_slice(&byte_buf[..n]);
                        for &byte in &byte_buf[..n] {
                            parser.advance(&mut handler, byte);
                        }
                        let data = String::from_utf8_lossy(&output_buf).to_string();
                        let _ = event_tx_for_read.send(Event::Output { data });
                        output_buf.clear();
                    }
                    Err(_) => break,
                }
            }

            if !output_buf.is_empty() {
                let data = String::from_utf8_lossy(&output_buf).to_string();
                let _ = event_tx_for_read.send(Event::Output { data });
            }
        });

        let grid_for_render = Arc::clone(&grid);
        let event_tx_for_render = event_tx.clone();
        let _render_thread = thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(41)); // ~24fps
            let mut grid = grid_for_render.lock().unwrap();
            let cells = grid.drain_dirty();
            if !cells.is_empty() {
                let cols = grid.cols;
                let rows = grid.rows;
                let _ = event_tx_for_render.send(Event::Render { cols, rows, cells });
            }
        });

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let child_for_exit = Arc::clone(&child_arc);
        let event_tx_for_exit = event_tx;
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
                    let _ = event_tx_for_exit.send(Event::Exit { code, signal: None });
                }
                Err(e) => {
                    let _ = event_tx_for_exit.send(Event::Error {
                        message: format!("Child wait failed: {}", e),
                    });
                }
            }
        });

        Ok(Self {
            grid,
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
            .map_err(|e| anyhow!("Resize failed: {}", e))?;
        let mut grid = self.grid.lock().unwrap();
        grid.resize(cols, rows);
        Ok(())
    }

    pub fn kill(&self) -> Result<()> {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            child.kill().map_err(|e| anyhow!("Kill failed: {}", e))
        } else {
            Ok(())
        }
    }

    pub fn wait(&self) -> Result<portable_pty::ExitStatus> {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            child.wait().map_err(|e| anyhow!("Wait failed: {}", e))
        } else {
            Err(anyhow!("No child process"))
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
