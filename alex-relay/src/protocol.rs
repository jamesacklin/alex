use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub enum Frame {
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
    fn roundtrip_http_request() {
        let frame = Frame::HttpRequest {
            request_id: 42,
            method: "GET".to_string(),
            uri: "/books".to_string(),
            headers: vec![("host".to_string(), "example.com".to_string())],
            body: vec![1, 2, 3],
        };
        let encoded = frame.encode().unwrap();
        let decoded = Frame::decode(&encoded).unwrap();
        match decoded {
            Frame::HttpRequest {
                request_id,
                method,
                uri,
                headers,
                body,
            } => {
                assert_eq!(request_id, 42);
                assert_eq!(method, "GET");
                assert_eq!(uri, "/books");
                assert_eq!(headers.len(), 1);
                assert_eq!(body, vec![1, 2, 3]);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn roundtrip_response_chunk() {
        let frame = Frame::ResponseChunk {
            request_id: 7,
            data: vec![0u8; 65536],
        };
        let encoded = frame.encode().unwrap();
        let decoded = Frame::decode(&encoded).unwrap();
        match decoded {
            Frame::ResponseChunk { request_id, data } => {
                assert_eq!(request_id, 7);
                assert_eq!(data.len(), 65536);
            }
            _ => panic!("wrong variant"),
        }
    }
}
