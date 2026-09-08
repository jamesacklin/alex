//! Ownership proof for a public tunnel name (F02).
//!
//! Registration used to prove only that the binary `Register` frame's
//! subdomain matched the URL query, and the relay persisted no ownership
//! record at all.  Once the owner disconnected, any client could register
//! the same public hostname and start answering requests — and receiving
//! cookies — meant for that owner.
//!
//! The client now holds a 32-byte secret for its name.  On every connection
//! the relay sends a fresh random nonce and the client answers with
//! `HMAC-SHA256(secret, nonce || subdomain)`.  The secret never crosses the
//! wire after the initial claim, and because the nonce is per-connection a
//! captured proof cannot be replayed on a later one.
//!
//! HMAC is implemented here on top of `sha2`, which the crate already
//! depends on, rather than adding a dependency and a lockfile change for
//! twenty lines of well-specified padding.

use sha2::{Digest, Sha256};

const BLOCK_SIZE: usize = 64;
pub const SECRET_BYTES: usize = 32;
pub const NONCE_BYTES: usize = 32;

/// HMAC-SHA256 as specified in RFC 2104.
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut padded_key = [0u8; BLOCK_SIZE];

    if key.len() > BLOCK_SIZE {
        let digest = Sha256::digest(key);
        padded_key[..digest.len()].copy_from_slice(&digest);
    } else {
        padded_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36u8; BLOCK_SIZE];
    let mut outer_pad = [0x5cu8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= padded_key[index];
        outer_pad[index] ^= padded_key[index];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);

    let mut result = [0u8; 32];
    result.copy_from_slice(&outer.finalize());
    result
}

/// The message a proof is computed over: the nonce followed by the name.
///
/// Binding the subdomain in means a proof captured for one name cannot be
/// presented for another, even if the relay reused a nonce by accident.
pub fn proof_message(nonce: &[u8], subdomain: &str) -> Vec<u8> {
    let mut message = Vec::with_capacity(nonce.len() + subdomain.len());
    message.extend_from_slice(nonce);
    message.extend_from_slice(subdomain.as_bytes());
    message
}

/// Compute the ownership proof for a challenge.
pub fn compute_proof(secret: &[u8], nonce: &[u8], subdomain: &str) -> Vec<u8> {
    hmac_sha256(secret, &proof_message(nonce, subdomain)).to_vec()
}

/// Constant-time equality, so verification cannot be timed byte by byte.
pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        difference |= a ^ b;
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 4231 test case 1.
    #[test]
    fn matches_rfc4231_case_1() {
        let key = [0x0bu8; 20];
        let mac = hmac_sha256(&key, b"Hi There");
        assert_eq!(
            hex(&mac),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    /// RFC 4231 test case 2.
    #[test]
    fn matches_rfc4231_case_2() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(
            hex(&mac),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    /// RFC 4231 test case 6: a key longer than the block size is hashed first.
    #[test]
    fn matches_rfc4231_case_6() {
        let key = [0xaau8; 131];
        let mac = hmac_sha256(
            &key,
            b"Test Using Larger Than Block-Size Key - Hash Key First",
        );
        assert_eq!(
            hex(&mac),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn proof_is_specific_to_the_nonce() {
        let secret = [7u8; SECRET_BYTES];
        let first = compute_proof(&secret, &[1u8; NONCE_BYTES], "gentle-morning-tide");
        let second = compute_proof(&secret, &[2u8; NONCE_BYTES], "gentle-morning-tide");
        assert_ne!(first, second, "a replayed proof must not verify");
    }

    #[test]
    fn proof_is_specific_to_the_subdomain() {
        let secret = [7u8; SECRET_BYTES];
        let nonce = [1u8; NONCE_BYTES];
        assert_ne!(
            compute_proof(&secret, &nonce, "gentle-morning-tide"),
            compute_proof(&secret, &nonce, "gentle-evening-tide")
        );
    }

    #[test]
    fn proof_is_specific_to_the_secret() {
        let nonce = [1u8; NONCE_BYTES];
        assert_ne!(
            compute_proof(&[7u8; SECRET_BYTES], &nonce, "name"),
            compute_proof(&[8u8; SECRET_BYTES], &nonce, "name")
        );
    }

    #[test]
    fn constant_time_eq_compares_content_and_length() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
