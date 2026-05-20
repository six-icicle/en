// PTY spike: spawn `claude` in a PTY, bridge stdio to a WebSocket so an
// xterm.js page in the browser can render the live session.
//
// Run:    cargo run
// Then open spike/pty-spike/index.html in a browser.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    #[serde(rename = "input")]
    Input { data: String },
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let addr = "127.0.0.1:9001";
    let listener = TcpListener::bind(addr).await?;
    println!("pty-spike: listening on ws://{addr}");
    println!("open spike/pty-spike/index.html in your browser");

    while let Ok((stream, peer)) = listener.accept().await {
        println!("[+] client connected: {peer}");
        tokio::spawn(async move {
            if let Err(e) = handle(stream).await {
                eprintln!("[-] client {peer} error: {e:?}");
            } else {
                println!("[-] client {peer} disconnected");
            }
        });
    }
    Ok(())
}

async fn handle(stream: tokio::net::TcpStream) -> anyhow::Result<()> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut ws_tx, mut ws_rx) = ws.split();

    // Spawn claude in a PTY
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: 36,
        cols: 140,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }
    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let master = Arc::new(Mutex::new(pair.master));
    let mut reader = master.lock().unwrap().try_clone_reader()?;
    let writer = Arc::new(Mutex::new(master.lock().unwrap().take_writer()?));

    // Channel: pty stdout bytes → websocket
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // ws → pty (input + resize)
    let writer_in = writer.clone();
    let master_in = master.clone();
    let ws_to_pty = async move {
        while let Some(msg) = ws_rx.next().await {
            let msg = match msg {
                Ok(m) => m,
                Err(_) => break,
            };
            match msg {
                Message::Text(txt) => {
                    if let Ok(parsed) = serde_json::from_str::<ClientMsg>(&txt) {
                        match parsed {
                            ClientMsg::Input { data } => {
                                let _ = writer_in.lock().unwrap().write_all(data.as_bytes());
                            }
                            ClientMsg::Resize { cols, rows } => {
                                let _ = master_in.lock().unwrap().resize(PtySize {
                                    cols,
                                    rows,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                });
                            }
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };

    // pty → ws
    let pty_to_ws = async move {
        while let Some(chunk) = rx.recv().await {
            if ws_tx.send(Message::Binary(chunk.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_tx.close().await;
    };

    tokio::select! {
        _ = ws_to_pty => {},
        _ = pty_to_ws => {},
    }

    let _ = child.kill();
    Ok(())
}
