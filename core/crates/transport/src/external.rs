//! What an external room reports every ten seconds, beside its flat fields.
//!
//! A Switch room wrote two lines until 2026-11-27: the pads-to-picture figure,
//! and « ce spectateur ne suit pas » when a viewer suffered. Nothing said
//! whether a picture that reached the page 117 ms late had reached the worker
//! late too, waited in its queue, or waited on its socket (audit WK-1). The
//! worker's line now says it. Its flat fields carry the streams and the worst
//! viewer and seat, so one `jq` reads them. The detail of each viewer and each
//! seat varies in number, and travels as one JSON array per kind, where an
//! unmeasured value is `null`, never zero.

use nel3ab_telemetry::Summary;
use serde_json::{Value, json};

use crate::browser::{PadArrivals, ViewerWrites};
use crate::ingress::PadsReport;

/// A distribution as three numbers, or three `null`s when nothing was measured.
fn spread(prefix: &str, summary: Option<Summary>) -> [(String, Value); 3] {
    let at = |pick: fn(&Summary) -> f64| summary.as_ref().map_or(Value::Null, |s| json!(pick(s)));
    [
        (format!("{prefix}_p50_ms"), at(|s| s.p50)),
        (format!("{prefix}_p95_ms"), at(|s| s.p95)),
        (format!("{prefix}_max_ms"), at(|s| s.max)),
    ]
}

/// Each viewer's queue wait and socket write over the window, as a JSON array.
///
/// A viewer that wrote nothing still appears, with `frames` at zero and its
/// distributions `null`: a page that received nothing for ten seconds is the
/// thing to see.
#[must_use]
pub fn viewers_json(writes: &[(&str, ViewerWrites)]) -> String {
    let all: Vec<Value> = writes
        .iter()
        .map(|(stream, one)| {
            let mut entry = serde_json::Map::new();
            entry.insert("viewer".into(), json!(one.tag));
            entry.insert("stream".into(), json!(stream));
            entry.insert("frames".into(), json!(one.frames));
            entry.extend(spread("wait", one.wait));
            entry.extend(spread("write", one.write));
            Value::Object(entry)
        })
        .collect();
    Value::Array(all).to_string()
}

/// Each seat that received or was sent something, as a JSON array.
///
/// The arrivals are dated in the seat's socket thread; the rest is what the
/// pads thread handed to `pads.py` for that seat.
#[must_use]
pub fn seats_json(arrivals: &[PadArrivals], pads: &PadsReport) -> String {
    let all: Vec<Value> = arrivals
        .iter()
        .zip(pads.seats.iter())
        .enumerate()
        .filter(|(_, (came, went))| came.frames > 0 || went.sent > 0)
        .map(|(index, (came, went))| {
            json!({
                "seat": index + 1,
                "frames": came.frames,
                "over_17_ms": came.over_17_ms,
                "over_50_ms": came.over_50_ms,
                "gap_max_ms": came.gap_max_ms,
                "sent": went.sent,
                "repeated": went.repeated,
                "rescued": went.kept.rescued,
                "deferred": went.kept.deferred,
            })
        })
        .collect();
    Value::Array(all).to_string()
}

/// The worst viewer of the window: its longest queue wait and longest write.
///
/// `None` when no viewer wrote a picture.
#[must_use]
pub fn worst_viewer(writes: &[(&str, ViewerWrites)]) -> (Option<f64>, Option<f64>) {
    let most = |pick: fn(&ViewerWrites) -> Option<Summary>| {
        writes
            .iter()
            .filter_map(|(_, one)| pick(one).map(|summary| summary.max))
            .reduce(f64::max)
    };
    (most(|one| one.wait), most(|one| one.write))
}

/// Every seat together: gaps over one and three pictures, and the longest.
#[must_use]
pub fn worst_seat(arrivals: &[PadArrivals]) -> (u64, u64, Option<f64>) {
    (
        arrivals.iter().map(|seat| seat.over_17_ms).sum(),
        arrivals.iter().map(|seat| seat.over_50_ms).sum(),
        arrivals
            .iter()
            .filter_map(|seat| seat.gap_max_ms)
            .reduce(f64::max),
    )
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use crate::edges::Kept;
    use crate::ingress::SeatPads;

    fn summary(max: f64) -> Summary {
        Summary {
            samples: 3,
            p50: 1.0,
            p95: 2.0,
            p99: 2.0,
            max,
        }
    }

    #[test]
    fn each_viewer_says_its_wait_and_write_and_absence_is_null() {
        let writes = [
            (
                "plein",
                ViewerWrites {
                    tag: 3,
                    frames: 600,
                    wait: Some(summary(4.0)),
                    write: Some(summary(130.0)),
                },
            ),
            (
                "demi",
                ViewerWrites {
                    tag: 7,
                    frames: 0,
                    wait: None,
                    write: None,
                },
            ),
        ];
        let said: Value = serde_json::from_str(&viewers_json(&writes)).unwrap();
        assert_eq!(said[0]["viewer"], 3);
        assert_eq!(said[0]["stream"], "plein");
        assert_eq!(said[0]["write_max_ms"], 130.0);
        assert_eq!(said[0]["wait_p95_ms"], 2.0);
        // The twin: a viewer that wrote nothing is there, and unmeasured.
        assert_eq!(said[1]["frames"], 0);
        assert_eq!(said[1]["write_max_ms"], Value::Null);
        assert_eq!(worst_viewer(&writes), (Some(4.0), Some(130.0)));
        assert_eq!(worst_viewer(&writes[1..]), (None, None));
    }

    #[test]
    fn only_the_seats_in_use_are_listed_with_both_ends() {
        let arrivals = [
            PadArrivals::default(),
            PadArrivals {
                frames: 2500,
                over_17_ms: 40,
                over_50_ms: 3,
                gap_max_ms: Some(121.0),
            },
            PadArrivals {
                frames: 1,
                over_17_ms: 0,
                over_50_ms: 0,
                gap_max_ms: None,
            },
            PadArrivals::default(),
        ];
        let mut pads = PadsReport {
            seats: [SeatPads::default(); 4],
            send: None,
        };
        pads.seats[1] = SeatPads {
            sent: 2400,
            repeated: 2350,
            kept: Kept {
                rescued: 2,
                deferred: 5,
            },
        };
        let said: Value = serde_json::from_str(&seats_json(&arrivals, &pads)).unwrap();
        assert_eq!(said.as_array().unwrap().len(), 2, "seats 1 and 4 are idle");
        assert_eq!(said[0]["seat"], 2);
        assert_eq!(said[0]["over_50_ms"], 3);
        assert_eq!(said[0]["gap_max_ms"], 121.0);
        assert_eq!(said[0]["repeated"], 2350);
        assert_eq!(said[0]["rescued"], 2);
        // One frame has no gap: null, not zero.
        assert_eq!(said[1]["gap_max_ms"], Value::Null);
        assert_eq!(worst_seat(&arrivals), (40, 3, Some(121.0)));
        assert_eq!(worst_seat(&[PadArrivals::default()]), (0, 0, None));
    }
}
