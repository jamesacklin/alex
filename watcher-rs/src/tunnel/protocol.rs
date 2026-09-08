use serde::{Deserialize, Serialize};

/// Wire protocol version.
///
/// Version 1 registered a name by simply asserting it. Version 2 requires a
/// challenge/response ownership proof (see `super::auth`) and adds request
/// cancellation. The two are deliberately incompatible: a v1 client sends
/// `Frame::Register`, which a v2 relay rejects with an explanatory
/// `RegisterAck`, and a v1 relay never sends `Frame::Challenge`, so a v2
/// client times out waiting for one and says so. Mixed versions fail
/// clearly rather than silently degrading to unauthenticated registration.
pub const PROTOCOL_VERSION: u16 = 2;

/// Frame variants are identified by their declaration index on the wire
/// (bincode encodes an enum discriminant as a u32), so new variants must be
/// appended and existing ones must never be reordered or removed.
#[derive(Debug, Serialize, Deserialize)]
pub enum Frame {
    /// Protocol v1 registration. Retained so a v2 relay can recognise an
    /// old client and reject it with a useful message.
    Register {
        subdomain: String,
    },
    RegisterAck {
        success: bool,
        message: String,
    },
    HttpRequest {
        request_id: u64,
        method: String,
        uri: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    HttpResponse {
        request_id: u64,
        status: u16,
        headers: Vec<(String, String)>,
    },
    ResponseChunk {
        request_id: u64,
        data: Vec<u8>,
    },
    ResponseEnd {
        request_id: u64,
    },
    Ping,
    Pong,
    /// Relay → client, sent immediately after the socket is accepted.
    /// `claimed` says whether the relay already holds an owner secret for
    /// this name, which tells the client whether to claim or to prove.
    Challenge {
        protocol_version: u16,
        nonce: Vec<u8>,
        claimed: bool,
    },
    /// Client → relay: take ownership of a name that has no owner yet.
    Claim {
        protocol_version: u16,
        subdomain: String,
        secret: Vec<u8>,
    },
    /// Client → relay: prove ownership of an already-claimed name.
    Prove {
        protocol_version: u16,
        subdomain: String,
        proof: Vec<u8>,
    },
    /// Client → relay: prove ownership and replace the stored secret.
    Rotate {
        protocol_version: u16,
        subdomain: String,
        proof: Vec<u8>,
        new_secret: Vec<u8>,
    },
    /// Either direction: stop work on a request. The relay sends it when the
    /// browser disconnects; the client sends it when the local request
    /// fails in a way that leaves no response.
    Cancel {
        request_id: u64,
    },
}

impl Frame {
    pub fn encode(&self) -> Result<Vec<u8>, bincode::Error> {
        bincode::serialize(self)
    }

    pub fn decode(data: &[u8]) -> Result<Self, bincode::Error> {
        bincode::deserialize(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_register() {
        let frame = Frame::Register {
            subdomain: "gentle-morning-tide".to_string(),
        };
        let encoded = frame.encode().unwrap();
        let decoded = Frame::decode(&encoded).unwrap();
        match decoded {
            Frame::Register { subdomain } => assert_eq!(subdomain, "gentle-morning-tide"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn register_wire_format_matches_worker_codec() {
        let encoded = Frame::Register {
            subdomain: "demo".to_string(),
        }
        .encode()
        .unwrap();

        assert_eq!(
            encoded,
            vec![
                0, 0, 0, 0, // Register enum variant
                4, 0, 0, 0, 0, 0, 0, 0, // String byte length (u64 LE)
                b'd', b'e', b'm', b'o',
            ]
        );
    }

    #[test]
    fn roundtrip_http_response() {
        let frame = Frame::HttpResponse {
            request_id: 99,
            status: 200,
            headers: vec![("content-type".to_string(), "text/html".to_string())],
        };
        let encoded = frame.encode().unwrap();
        let decoded = Frame::decode(&encoded).unwrap();
        match decoded {
            Frame::HttpResponse {
                request_id,
                status,
                headers,
            } => {
                assert_eq!(request_id, 99);
                assert_eq!(status, 200);
                assert_eq!(headers[0].0, "content-type");
            }
            _ => panic!("wrong variant"),
        }
    }

    /// The Worker codec identifies frames by these indices, so they are part
    /// of the wire contract. Reordering the enum would silently reinterpret
    /// every frame.
    #[test]
    fn frame_variant_indices_are_stable() {
        let cases: Vec<(Frame, u32)> = vec![
            (
                Frame::Register {
                    subdomain: String::new(),
                },
                0,
            ),
            (
                Frame::RegisterAck {
                    success: true,
                    message: String::new(),
                },
                1,
            ),
            (
                Frame::HttpRequest {
                    request_id: 0,
                    method: String::new(),
                    uri: String::new(),
                    headers: vec![],
                    body: vec![],
                },
                2,
            ),
            (
                Frame::HttpResponse {
                    request_id: 0,
                    status: 0,
                    headers: vec![],
                },
                3,
            ),
            (
                Frame::ResponseChunk {
                    request_id: 0,
                    data: vec![],
                },
                4,
            ),
            (Frame::ResponseEnd { request_id: 0 }, 5),
            (Frame::Ping, 6),
            (Frame::Pong, 7),
            (
                Frame::Challenge {
                    protocol_version: PROTOCOL_VERSION,
                    nonce: vec![],
                    claimed: false,
                },
                8,
            ),
            (
                Frame::Claim {
                    protocol_version: PROTOCOL_VERSION,
                    subdomain: String::new(),
                    secret: vec![],
                },
                9,
            ),
            (
                Frame::Prove {
                    protocol_version: PROTOCOL_VERSION,
                    subdomain: String::new(),
                    proof: vec![],
                },
                10,
            ),
            (
                Frame::Rotate {
                    protocol_version: PROTOCOL_VERSION,
                    subdomain: String::new(),
                    proof: vec![],
                    new_secret: vec![],
                },
                11,
            ),
            (Frame::Cancel { request_id: 0 }, 12),
        ];

        for (frame, expected_index) in cases {
            let encoded = frame.encode().unwrap();
            let index = u32::from_le_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]);
            assert_eq!(index, expected_index, "variant index changed for {frame:?}");
        }
    }

    #[test]
    fn roundtrip_challenge_and_proof_frames() {
        let challenge = Frame::Challenge {
            protocol_version: PROTOCOL_VERSION,
            nonce: vec![1, 2, 3, 4],
            claimed: true,
        };
        match Frame::decode(&challenge.encode().unwrap()).unwrap() {
            Frame::Challenge {
                protocol_version,
                nonce,
                claimed,
            } => {
                assert_eq!(protocol_version, PROTOCOL_VERSION);
                assert_eq!(nonce, vec![1, 2, 3, 4]);
                assert!(claimed);
            }
            other => panic!("wrong variant: {other:?}"),
        }

        let prove = Frame::Prove {
            protocol_version: PROTOCOL_VERSION,
            subdomain: "demo".to_string(),
            proof: vec![9; 32],
        };
        match Frame::decode(&prove.encode().unwrap()).unwrap() {
            Frame::Prove {
                subdomain, proof, ..
            } => {
                assert_eq!(subdomain, "demo");
                assert_eq!(proof.len(), 32);
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }
}
