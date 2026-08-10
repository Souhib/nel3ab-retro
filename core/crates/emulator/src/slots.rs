//! Which of the four controller ports a session serves.

use nel3ab_protocol::{MAX_PLAYERS, PlayerSlot};

/// The set of controller ports a session drives.
///
/// A `Vec<PlayerSlot>` would have let a caller ask for player 2 twice, which
/// would create the FIFO twice, write `[GCPad2]` twice, and leave two encoders
/// diffing against each other's writes. A bitmask cannot express that at all,
/// and it iterates in port order for free — so the generated config is
/// byte-reproducible without anyone remembering to sort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SlotSet(u8);

impl SlotSet {
    /// A session with no players yet.
    pub const EMPTY: Self = Self(0);

    /// All four ports.
    pub const ALL: Self = Self(0b1111);

    /// Adds a port. Adding one twice is the same as adding it once.
    #[must_use]
    pub const fn with(self, slot: PlayerSlot) -> Self {
        Self(self.0 | (1 << slot.index()))
    }

    /// True when this session serves `slot`.
    #[must_use]
    pub const fn contains(self, slot: PlayerSlot) -> bool {
        self.0 & (1 << slot.index()) != 0
    }

    /// True when no port is served.
    #[must_use]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// How many ports are served.
    #[must_use]
    pub const fn len(self) -> u32 {
        self.0.count_ones()
    }

    /// The served ports, in ascending port order.
    pub fn iter(self) -> impl Iterator<Item = PlayerSlot> {
        (1..=MAX_PLAYERS).filter_map(move |raw| {
            // `raw` comes from `1..=MAX_PLAYERS`, the exact range `PlayerSlot`
            // accepts, so the constructor cannot reject it and there is no error
            // to handle — only a value to discard on an impossible branch.
            let slot = PlayerSlot::new(raw).ok()?;
            self.contains(slot).then_some(slot)
        })
    }
}

impl FromIterator<PlayerSlot> for SlotSet {
    fn from_iter<I: IntoIterator<Item = PlayerSlot>>(iter: I) -> Self {
        iter.into_iter().fold(Self::EMPTY, Self::with)
    }
}

impl IntoIterator for SlotSet {
    type Item = PlayerSlot;
    type IntoIter = Box<dyn Iterator<Item = PlayerSlot>>;

    fn into_iter(self) -> Self::IntoIter {
        Box::new(self.iter())
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    fn slot(raw: u8) -> PlayerSlot {
        PlayerSlot::new(raw).unwrap()
    }

    #[test]
    fn adding_the_same_port_twice_changes_nothing() {
        // The whole reason this type exists instead of a Vec.
        let once = SlotSet::EMPTY.with(slot(2));
        let twice = once.with(slot(2));
        assert_eq!(once, twice);
        assert_eq!(twice.len(), 1);
    }

    #[test]
    fn iteration_is_in_port_order_regardless_of_insertion_order() {
        let set: SlotSet = [slot(4), slot(1), slot(3)].into_iter().collect();
        let ports: Vec<u8> = set.iter().map(PlayerSlot::get).collect();
        assert_eq!(ports, vec![1, 3, 4]);
    }

    #[test]
    fn membership_is_exact() {
        let set = SlotSet::EMPTY.with(slot(1)).with(slot(3));
        assert!(set.contains(slot(1)) && set.contains(slot(3)));
        // Negative twin: "contains what was added" is worthless without
        // "contains nothing else".
        assert!(!set.contains(slot(2)) && !set.contains(slot(4)));
    }

    #[test]
    fn the_empty_and_full_sets_are_what_they_claim() {
        assert!(SlotSet::EMPTY.is_empty());
        assert_eq!(SlotSet::EMPTY.len(), 0);
        assert_eq!(SlotSet::EMPTY.iter().count(), 0);

        assert!(!SlotSet::ALL.is_empty());
        assert_eq!(SlotSet::ALL.len(), u32::from(MAX_PLAYERS));
        let ports: Vec<u8> = SlotSet::ALL.iter().map(PlayerSlot::get).collect();
        assert_eq!(ports, vec![1, 2, 3, 4]);
    }
}
