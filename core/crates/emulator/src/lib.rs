//! Owns the Dolphin process and its input pipes.
//!
//! Inputs reach Dolphin through **named pipes** (`Device = Pipe/0/p1`), never
//! uinput or SDL: a pipe binds by FILE NAME, so player 2 is player 2 because we
//! named the file, not because an enumeration order happened to hold. That
//! single choice removes the unstable-index class of bug outright.
//!
//! Milestone: M1.

#![forbid(unsafe_code)]
