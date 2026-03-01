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
}
