use rand::Rng;

const ADJECTIVES: &[&str] = &[
    "amber", "ancient", "autumn", "blazing", "bold", "brave", "bright", "broken",
    "calm", "caring", "central", "clever", "cold", "cool", "cosmic", "crisp",
    "crystal", "curious", "dancing", "daring", "dawn", "deep", "divine", "dreamy",
    "drifting", "dusky", "eager", "early", "eastern", "emerald", "endless", "evening",
    "fading", "fallen", "fancy", "fearless", "fierce", "floral", "flying", "foggy",
    "forest", "fragrant", "free", "friendly", "frosty", "frozen", "gentle", "gilded",
    "glad", "gliding", "golden", "graceful", "grand", "green", "growing", "happy",
    "hidden", "hollow", "humble", "hushed", "icy", "idle", "inner", "ivory",
    "jade", "jolly", "keen", "kind", "lasting", "late", "leafy", "light",
    "lively", "lonely", "long", "lost", "loving", "lucky", "lunar", "lush",
    "magic", "mellow", "mighty", "misty", "modest", "molten", "moonlit", "morning",
    "mossy", "muddy", "muted", "narrow", "neat", "new", "nimble", "noble",
    "northern", "odd", "old", "open", "orange", "outer", "pale", "patient",
    "peaceful", "plain", "playful", "polar", "polished", "pretty", "proud", "pure",
    "purple", "quick", "quiet", "radiant", "rainy", "rapid", "rare", "regal",
    "restful", "rich", "rising", "rocky", "rosy", "rough", "round", "royal",
    "ruby", "rugged", "running", "rustic", "sacred", "sandy", "scarlet", "secret",
    "serene", "shady", "sharp", "shining", "shy", "silent", "silky", "silver",
    "simple", "sleepy", "slender", "small", "smooth", "snowy", "soft", "solar",
    "solemn", "solid", "southern", "sparkling", "spring", "steady", "steep", "still",
    "stormy", "stout", "strong", "summer", "sunny", "super", "sweet", "swift",
    "tall", "tawny", "tender", "thick", "tidal", "tiny", "tranquil", "tropical",
    "true", "twilight", "upper", "vast", "velvet", "vivid", "wandering", "warm",
    "wavy", "western", "white", "whole", "wide", "wild", "winding", "windy",
    "winter", "wise", "wooden", "young", "zealous",
    "airy", "alpine", "aqua", "ashen", "balmy", "bitter", "blue", "breezy",
    "bronze", "burning", "casual", "charming", "cherry", "clean", "clear", "cloudy",
    "coastal", "cozy", "dainty", "dark", "dear", "dense", "dim", "distant",
    "double", "dry", "dusty", "earthen", "elastic", "electric", "empty", "eternal",
    "exotic", "faint", "fair", "famous", "faraway", "fertile", "fine", "first",
    "flat", "fleet", "fluid", "fond", "formal", "fresh", "frugal", "full",
    "glassy", "gleaming", "gloomy", "glossy", "good", "gray", "great", "gusty",
    "handy", "hardy", "hazy", "heavy", "helpful", "high", "honest", "hopeful",
    "huge", "indigo", "infinite", "iron", "keen", "large", "lavish", "lean",
    "level", "linear", "little", "local", "loud", "lovely", "low", "loyal",
    "major", "marble", "marine", "massive", "merry", "middle", "mild", "mineral",
    "minor", "modern", "natural", "nearby", "neutral", "next", "nice", "noted",
    "novel", "oaken", "olive", "onyx", "opal", "orderly", "other", "pacific",
    "pastel", "pearly", "pebble", "perfect", "petite", "pink", "placid", "plush",
    "primal", "prime", "proper", "public", "quaint", "raw", "ready", "real",
    "remote", "ripe", "robust", "russet", "sable", "sage", "satin", "second",
    "select", "senior", "settled", "sheer", "short", "single", "slight", "slow",
    "smart", "sober", "sonic", "spare", "stable", "stark", "stellar", "stone",
    "strict", "subtle", "sudden", "sunset", "supreme", "sure", "tame", "tepid",
    "thick", "thin", "third", "thorny", "tidy", "timber", "tired", "total",
    "tough", "triple", "turbo", "twin", "ultra", "unique", "urban", "usual",
    "vague", "valid", "varied", "verdant", "violet", "vital", "vocal", "void",
    "waxen", "weary", "weekly", "wintry", "witty", "worthy",
];

const NOUNS: &[&str] = &[
    "aurora", "bay", "beacon", "birch", "bird", "bloom", "boulder", "branch",
    "breeze", "bridge", "brook", "canopy", "canyon", "cape", "cedar", "cherry",
    "cliff", "cloud", "coast", "coral", "cove", "creek", "crest", "crystal",
    "current", "dale", "dawn", "delta", "desert", "dew", "dove", "drift",
    "dune", "dusk", "eagle", "earth", "echo", "elm", "ember", "falcon",
    "falls", "fern", "field", "finch", "fjord", "flame", "flint", "flower",
    "fog", "forest", "forge", "fossil", "fountain", "fox", "frost", "garden",
    "glade", "glen", "gorge", "granite", "grove", "gust", "harbor", "haven",
    "hawk", "heath", "hedge", "heron", "hill", "hollow", "horizon", "island",
    "ivy", "jade", "jasper", "lake", "lark", "laurel", "leaf", "light",
    "lily", "lotus", "maple", "marsh", "meadow", "mesa", "mist", "moon",
    "moss", "mountain", "oak", "oasis", "ocean", "orchid", "otter", "owl",
    "palm", "pass", "path", "peak", "pearl", "pebble", "perch", "pine",
    "plain", "planet", "plateau", "plum", "pond", "prairie", "prism", "quail",
    "rain", "rapids", "raven", "reef", "ridge", "river", "robin", "rock",
    "root", "rose", "sage", "sand", "sea", "shade", "shadow", "shore",
    "sky", "snow", "spark", "spring", "spruce", "star", "stone", "storm",
    "stream", "summit", "sun", "surf", "swan", "temple", "thorn", "thunder",
    "tide", "timber", "trail", "tree", "tulip", "valley", "vine", "violet",
    "vista", "water", "wave", "whisper", "willow", "wind", "wing", "wood",
    "wren", "zenith",
    "acorn", "agate", "arch", "aspen", "atoll", "bamboo", "basin", "blaze",
    "bluff", "brush", "cairn", "candle", "cavern", "chasm", "cinder", "citrus",
    "cobalt", "comet", "compass", "copper", "cosmos", "crane", "daisy", "den",
    "diamond", "dome", "drake", "drum", "ember", "fable", "feather", "ferry",
    "fir", "flare", "flight", "flute", "foam", "gate", "gem", "glacier",
    "grass", "grove", "gull", "haven", "hemp", "hive", "horn", "hound",
    "inlet", "iris", "jet", "jewel", "kelp", "kettle", "knoll", "lagoon",
    "lance", "lantern", "lava", "ledge", "lichen", "linden", "lodge", "loom",
    "mantle", "marble", "marigold", "mill", "minnow", "mirror", "moat", "mortar",
    "nectar", "nest", "north", "notch", "nova", "oar", "onyx", "orbit",
    "osprey", "oxbow", "panther", "parch", "pasture", "patch", "pelican", "pepper",
    "pier", "pillar", "plover", "point", "poplar", "portal", "quartz", "quest",
    "rapids", "reef", "ripple", "rover", "ruin", "rush", "saffron", "sail",
    "sapphire", "scarab", "seed", "shell", "shoal", "sierra", "silk", "slate",
    "slope", "snipe", "solstice", "south", "sparrow", "spire", "stag", "steppe",
    "stork", "strait", "sunrise", "terrace", "thistle", "torch", "tower", "trout",
    "tundra", "urchin", "vale", "vapor", "veil", "verge", "vortex", "wadi",
    "walnut", "warren", "wharf", "wight", "wisp", "wolf", "yew", "zephyr",
];

/// Generate a three-word subdomain (adjective-adjective-noun).
pub fn generate_subdomain() -> String {
    let mut rng = rand::rng();
    let adj1 = ADJECTIVES[rng.random_range(0..ADJECTIVES.len())];
    let adj2 = ADJECTIVES[rng.random_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.random_range(0..NOUNS.len())];
    format!("{adj1}-{adj2}-{noun}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_subdomain_has_three_parts() {
        let sub = generate_subdomain();
        let parts: Vec<&str> = sub.split('-').collect();
        assert_eq!(parts.len(), 3);
        assert!(ADJECTIVES.contains(&parts[0]));
        assert!(ADJECTIVES.contains(&parts[1]));
        assert!(NOUNS.contains(&parts[2]));
    }
}
