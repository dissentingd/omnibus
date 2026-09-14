// #203 COLLECTED coverage (field report by robotshavehearts2): a collected book's `coversIssues`
// names the MAIN-RUN issue numbers it reprints — "1-6, 8" — and an OWNED book's coverage takes
// those issues out of "missing". The engine prefills it once at lane-sync time from the provider's
// own "Collects …" text and carries it through series.json for the zero-API restore; Node does
// the missing-issue math and validates edits.
//
// EXACT twin of src/lib/utils/coverage.ts — keep the rules and the tests mirrored.
use regex::Regex;
use std::sync::OnceLock;

/// The widest range one token may span — "1-9999" is a typo, not a collection.
pub(crate) const MAX_RANGE_SPAN: i64 = 500;

fn re_range() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\d{1,4})\s*[-–—]\s*#?(\d{1,4})$").unwrap())
}
fn re_single() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{1,4}(?:\.\d+)?[a-zA-Z]?$").unwrap())
}

fn strip_zeros(s: &str) -> String {
    let t = s.trim_start_matches('0');
    if t.is_empty() || !t.starts_with(|c: char| c.is_ascii_digit()) {
        // "0", "00", "0.5" → keep one leading zero where the original had digits before a non-digit
        let stripped = s.trim_start_matches('0');
        if stripped.starts_with('.') { return format!("0{stripped}"); }
        if stripped.is_empty() { return "0".to_string(); }
        return stripped.to_string();
    }
    t.to_string()
}

/// One token → its canonical form ("a-b", or a single number), or None.
fn canonical_token(raw: &str) -> Option<(String, Option<(i64, i64)>)> {
    let token = crate::metadata::normalize_fraction_numbers(raw.trim().trim_start_matches('#').trim_start());
    if token.is_empty() {
        return None;
    }
    if let Some(c) = re_range().captures(&token) {
        let a: i64 = c[1].parse().ok()?;
        let b: i64 = c[2].parse().ok()?;
        if b < a || b - a > MAX_RANGE_SPAN {
            return None;
        }
        return Some((if a == b { a.to_string() } else { format!("{a}-{b}") }, Some((a, b))));
    }
    if re_single().is_match(&token) {
        return Some((strip_zeros(&token), None));
    }
    None
}

/// Expands an expression into the issue numbers it names, in order, without duplicates. Tokens are
/// comma- or semicolon-separated; "a-b" (a ≤ b, span ≤ MAX_RANGE_SPAN) or a single number ("8",
/// "12a", "½" → "0.5", "001" → "1"). Anything else is skipped, never guessed.
///
/// The engine only prefills and carries coverage; the missing-issue math lives in Node. This twin
/// exists so the two sides can never read an expression differently, and for its mirrored tests.
#[allow(dead_code)]
pub(crate) fn expand_coverage(expr: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in expr.split([',', ';']) {
        let Some((canon, range)) = canonical_token(raw) else { continue };
        match range {
            Some((a, b)) => {
                for n in a..=b {
                    let s = n.to_string();
                    if !out.contains(&s) { out.push(s); }
                }
            }
            None => {
                if !out.contains(&canon) { out.push(canon); }
            }
        }
    }
    out
}

/// The canonical form — ranges as "a-b", singles as themselves, joined by ", " — or None when
/// nothing in it is a valid token.
pub(crate) fn normalize_coverage(expr: &str) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for raw in expr.split([',', ';']) {
        if let Some((canon, _)) = canonical_token(raw) {
            if !parts.contains(&canon) { parts.push(canon); }
        }
    }
    if parts.is_empty() { None } else { Some(parts.join(", ")) }
}

/// Whether `number` is one of the expanded coverage numbers (½ and 0.5 agree, 001 and 1 agree).
/// Twin of Node's `isCovered` — see `expand_coverage` for why it lives here unused.
#[allow(dead_code)]
pub(crate) fn is_covered(number: &str, expanded: &[String]) -> bool {
    if number.is_empty() { return false; }
    expanded.iter().any(|t| crate::metadata::is_same_issue(t, number))
}

fn re_keyword() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\b(?:collect(?:s|ing|ed)?|reprint(?:s|ing|ed)?)\b").unwrap())
}
fn re_first() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"#\s*(\d{1,4})(?:\s*[-–—]\s*#?(\d{1,4}))?").unwrap())
}
fn re_next() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^\s*(?:,|&|and)\s*#?(\d{1,4})(?:\s*[-–—]\s*#?(\d{1,4}))?").unwrap())
}
fn re_tags() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}
fn re_years() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\(\d{4}(?:\s*[-–—]\s*\d{4})?\)").unwrap())
}
fn re_annual() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\bannuals?\s*#?\s*\d{1,4}(?:\s*[-–—]\s*#?\d{1,4})?").unwrap())
}
fn re_ws() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").unwrap())
}
fn re_sentence_end() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\.(?:\s|$)").unwrap())
}
fn is_year(n: i64) -> bool { (1900..=2099).contains(&n) }

/// The coverage a provider's own text states — "Collects Batman (2011) #1-7." → "1-7" — used ONCE
/// to prefill a blank. Conservative on purpose: the numbers must follow a collect/reprint word in
/// the same sentence, the first must carry a "#", years and "Annual #N" are ignored, and anything
/// unclear yields None rather than a guess.
pub(crate) fn coverage_from_description(text: &str) -> Option<String> {
    let plain = re_tags().replace_all(text, " ").replace("&nbsp;", " ");
    let plain = re_ws().replace_all(&plain, " ").to_string();
    let kw = re_keyword().find(&plain)?;
    let mut fragment: String = plain[kw.end()..].to_string();
    if let Some(stop) = re_sentence_end().find(&fragment) {
        fragment.truncate(stop.start());
    }
    let fragment: String = fragment.chars().take(250).collect();
    let fragment = re_years().replace_all(&fragment, " ");
    let fragment = re_annual().replace_all(&fragment, " ").to_string();
    let first = re_first().captures(&fragment)?;
    let mut tokens: Vec<String> = Vec::new();
    let mut take = |a: &str, b: Option<&str>| {
        let x: i64 = match a.parse() { Ok(v) => v, Err(_) => return };
        let y: Option<i64> = b.and_then(|s| s.parse().ok());
        if is_year(x) || y.is_some_and(is_year) { return; }
        tokens.push(match y { Some(y) => format!("{x}-{y}"), None => x.to_string() });
    };
    take(&first[1], first.get(2).map(|m| m.as_str()));
    let whole = first.get(0).unwrap();
    let mut rest: String = fragment[whole.end()..].to_string();
    while let Some(m) = re_next().captures(&rest) {
        take(&m[1], m.get(2).map(|x| x.as_str()));
        let consumed = m.get(0).unwrap().end();
        rest = rest[consumed..].to_string();
    }
    normalize_coverage(&tokens.join(", "))
}

/// What a blank book's coverage is filled from, in order: what series.json remembered for this
/// provider book (a restore), the book's own text, and — only when the volume holds ONE book — the
/// volume's text (a trade series' "Collects #1-18" must not land on each of its three volumes).
pub(crate) fn coverage_fill_for(
    kind: &str,
    existing: Option<&str>,
    series_json_book: Option<&str>,
    book_description: Option<&str>,
    volume_description: Option<&str>,
    single_book_volume: bool,
) -> Option<String> {
    if kind != "COLLECTED" { return None; }
    if existing.is_some_and(|e| !e.trim().is_empty()) { return None; }
    if let Some(sj) = series_json_book.and_then(normalize_coverage) { return Some(sj); }
    if let Some(d) = book_description.and_then(coverage_from_description) { return Some(d); }
    if single_book_volume {
        if let Some(v) = volume_description.and_then(coverage_from_description) { return Some(v); }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==== EXACT twin of __tests__/lib/utils/coverage.test.ts — keep both in step. ====

    fn v(items: &[&str]) -> Vec<String> { items.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn expands_ranges_and_singles_in_order_without_duplicates() {
        assert_eq!(expand_coverage("1-6, 8"), v(&["1", "2", "3", "4", "5", "6", "8"]));
        assert_eq!(expand_coverage("#1-#3; #5"), v(&["1", "2", "3", "5"]));
        assert_eq!(expand_coverage("001, 002, 2"), v(&["1", "2"]));
        assert_eq!(expand_coverage("½, 2, 12a"), v(&["0.5", "2", "12a"]));
        assert_eq!(expand_coverage("3-3"), v(&["3"]));
    }

    #[test]
    fn skips_what_it_cannot_read_rather_than_guessing() {
        assert_eq!(expand_coverage("6-1"), Vec::<String>::new());
        assert_eq!(expand_coverage("1-9999"), Vec::<String>::new());
        assert_eq!(expand_coverage("abc, 1-x, , 4"), v(&["4"]));
        assert_eq!(expand_coverage(""), Vec::<String>::new());
    }

    #[test]
    fn normalizes_to_the_canonical_form_or_none() {
        assert_eq!(normalize_coverage(" 1 - 6 ,8 ").as_deref(), Some("1-6, 8"));
        assert_eq!(normalize_coverage("#4; #5; 4-4").as_deref(), Some("4, 5"));
        assert_eq!(normalize_coverage("½").as_deref(), Some("0.5"));
        assert_eq!(normalize_coverage("abc"), None);
        assert_eq!(normalize_coverage(""), None);
    }

    #[test]
    fn membership_compares_the_way_issue_numbers_do() {
        let set = expand_coverage("1-6, ½");
        assert!(is_covered("3", &set));
        assert!(is_covered("003", &set));
        assert!(is_covered("0.5", &set));
        assert!(!is_covered("7", &set));
        assert!(!is_covered("", &set));
        assert!(!is_covered("3", &[]));
    }

    #[test]
    fn reads_the_providers_collects_text_conservatively() {
        assert_eq!(coverage_from_description("Collects Batman (2011) #1-7.").as_deref(), Some("1-7"));
        assert_eq!(coverage_from_description("<p>Collecting <a href=\"x\">Amazing Spider-Man</a> #1-6, 8 and Annual #1.</p> Plus extras #99.").as_deref(), Some("1-6, 8"));
        assert_eq!(coverage_from_description("Reprints #4, #5 & #6").as_deref(), Some("4, 5, 6"));
        assert_eq!(coverage_from_description("This volume collects issues #12 - #18 of the 2008-2010 run.").as_deref(), Some("12-18"));
        assert_eq!(coverage_from_description("The story of 1963."), None);
        assert_eq!(coverage_from_description("Collects issues 1-6"), None);
        assert_eq!(coverage_from_description("Collects the 2011 series."), None);
    }

    #[test]
    fn fill_order_is_series_json_then_the_book_then_a_lone_volume_and_never_over_a_value() {
        let f = |ex: Option<&str>, sj: Option<&str>, bd: Option<&str>, vd: Option<&str>, single: bool| coverage_fill_for("COLLECTED", ex, sj, bd, vd, single);
        assert_eq!(f(None, Some("1-6"), Some("Collects #7-12"), None, false).as_deref(), Some("1-6"));
        assert_eq!(f(None, None, Some("Collects #7-12"), Some("Collects #1-18"), false).as_deref(), Some("7-12"));
        assert_eq!(f(None, None, None, Some("Collects #1-18"), true).as_deref(), Some("1-18"));
        assert_eq!(f(None, None, None, Some("Collects #1-18"), false), None, "a multi-book volume's text names the whole run, not this book");
        assert_eq!(f(Some("4-5"), Some("1-6"), Some("Collects #7-12"), None, true), None, "a value already there is never touched");
        assert_eq!(f(Some("  "), None, Some("Collects #2"), None, false).as_deref(), Some("2"), "blank counts as empty");
        assert_eq!(coverage_fill_for("ANNUAL", None, Some("1-6"), Some("Collects #1-6"), None, true), None, "annual lanes never carry coverage");
    }
}
