#![forbid(unsafe_code)]
//! Experimental ingress only. Browser transport, clips, seats and media are
//! the real project libraries; no live worker or control endpoint is used.
use anyhow::{Context, Result};
use nel3ab_protocol::PlayerSlot;
use nel3ab_transport::{
    browser::{BrowserServer, InputKind},
    ingress::Ingress,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

fn main() -> Result<()> {
    let root = PathBuf::from(
        std::env::args()
            .nth(1)
            .context("usage: bridge PRIVATE_PADS_DIRECTORY")?,
    );
    let owner = Arc::new(Mutex::new(None));
    let port = std::env::args()
        .nth(2)
        .map(|value| value.parse::<u16>())
        .transpose()?
        .unwrap_or(0);
    let server = Arc::new(BrowserServer::start_with_input(
        ([127, 0, 0, 1], port).into(),
        include_str!("../page.html"),
        Arc::from("[]"),
        Arc::from([]),
        PlayerSlot::new(4)?,
        &owner,
        InputKind::Switch,
    )?);
    server.half_offered(true);
    let url = format!("http://{}", server.address());
    std::fs::write(
        root.join("bridge.json"),
        serde_json::to_vec(&serde_json::json!({"url":url}))?,
    )?;
    // Exercise the exact ingress used by the installed room, including Unix
    // socket permissions. A second bridge missed the rumble failure on 2026-09-09.
    let _ingress = Ingress::bind(&root, Arc::clone(&server))?;
    eprintln!("Switch prototype: {url}");
    loop {
        thread::park();
    }
}
