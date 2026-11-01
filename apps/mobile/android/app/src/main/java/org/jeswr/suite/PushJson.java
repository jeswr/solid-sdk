// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Small bounded, strict JSON codec so push policy tests run on a plain JVM, without Android stubs. */
final class PushJson {
    private final String text;
    private int at;
    private PushJson(String text) { this.text = text; }

    static Object parse(String text) {
        if (text == null || text.length() > 131072) throw new IllegalArgumentException("Invalid JSON size");
        PushJson parser = new PushJson(text);
        Object value = parser.value(0);
        parser.space();
        if (parser.at != text.length()) throw new IllegalArgumentException("Trailing JSON");
        return value;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) {
        if (!(value instanceof Map)) throw new IllegalArgumentException("Expected object");
        return (Map<String, Object>) value;
    }

    static String string(Object value) {
        if (!(value instanceof String)) throw new IllegalArgumentException("Expected string");
        return (String) value;
    }

    static int integer(Object value, int max) {
        if (!(value instanceof Long) || (Long) value < 0 || (Long) value > max) {
            throw new IllegalArgumentException("Expected bounded integer");
        }
        return ((Long) value).intValue();
    }

    private void space() { while (at < text.length() && " \t\r\n".indexOf(text.charAt(at)) >= 0) at++; }
    private char take() {
        if (at >= text.length()) throw new IllegalArgumentException("Truncated JSON");
        return text.charAt(at++);
    }
    private void expect(char c) { if (take() != c) throw new IllegalArgumentException("Invalid JSON"); }
    private Object value(int depth) {
        if (depth > 8) throw new IllegalArgumentException("JSON nesting");
        space();
        char c = take();
        if (c == '"') return quoted();
        if (c == '{') {
            Map<String, Object> map = new LinkedHashMap<>();
            space();
            if (at < text.length() && text.charAt(at) == '}') { at++; return map; }
            do {
                space(); expect('"'); String key = quoted(); space(); expect(':');
                if (map.containsKey(key)) throw new IllegalArgumentException("Duplicate JSON key");
                map.put(key, value(depth + 1)); space(); c = take();
                if (c == '}') return map;
                if (c != ',') throw new IllegalArgumentException("Invalid object");
            } while (true);
        }
        if (c == '[') {
            List<Object> list = new ArrayList<>(); space();
            if (at < text.length() && text.charAt(at) == ']') { at++; return list; }
            do {
                list.add(value(depth + 1)); space(); c = take();
                if (c == ']') return list;
                if (c != ',') throw new IllegalArgumentException("Invalid array");
            } while (true);
        }
        at--;
        for (String token : new String[] { "true", "false", "null" }) {
            if (text.startsWith(token, at)) { at += token.length(); return token.equals("null") ? null : token.equals("true"); }
        }
        int start = at;
        while (at < text.length() && "-+0123456789.eE".indexOf(text.charAt(at)) >= 0) at++;
        String number = text.substring(start, at);
        if (!number.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")) throw new IllegalArgumentException("Invalid number");
        try {
            if (number.matches("-?(0|[1-9][0-9]*)")) return Long.valueOf(number);
            Double decimal = Double.valueOf(number);
            if (!Double.isFinite(decimal)) throw new IllegalArgumentException("Invalid number");
            return decimal;
        } catch (NumberFormatException e) { throw new IllegalArgumentException("Invalid number", e); }
    }
    private String quoted() {
        StringBuilder out = new StringBuilder();
        while (true) {
            char c = take();
            if (c == '"') break;
            if (c < 32) throw new IllegalArgumentException("JSON control character");
            if (c == '\\') {
                c = take();
                switch (c) {
                    case '"': case '\\': case '/': break;
                    case 'b': c = '\b'; break;
                    case 'f': c = '\f'; break;
                    case 'n': c = '\n'; break;
                    case 'r': c = '\r'; break;
                    case 't': c = '\t'; break;
                    case 'u':
                        if (at + 4 > text.length()) throw new IllegalArgumentException("JSON escape");
                        if (!text.substring(at, at + 4).matches("[0-9a-fA-F]{4}")) throw new IllegalArgumentException("JSON escape");
                        try { c = (char) Integer.parseInt(text.substring(at, at + 4), 16); }
                        catch (NumberFormatException e) { throw new IllegalArgumentException("JSON escape", e); }
                        at += 4; break;
                    default: throw new IllegalArgumentException("JSON escape");
                }
            }
            out.append(c);
        }
        for (int i = 0; i < out.length(); i++) {
            char c = out.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i == out.length() || !Character.isLowSurrogate(out.charAt(i))) throw new IllegalArgumentException("JSON surrogate");
            } else if (Character.isLowSurrogate(c)) throw new IllegalArgumentException("JSON surrogate");
        }
        return out.toString();
    }

    static String encode(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean || value instanceof Number) return value.toString();
        StringBuilder out = new StringBuilder();
        if (value instanceof Map) {
            out.append('{');
            for (Map.Entry<String, Object> entry : object(value).entrySet()) {
                if (out.length() > 1) out.append(',');
                out.append(encode(entry.getKey())).append(':').append(encode(entry.getValue()));
            }
            return out.append('}').toString();
        }
        if (value instanceof List) {
            out.append('[');
            for (Object item : (List<?>) value) { if (out.length() > 1) out.append(','); out.append(encode(item)); }
            return out.append(']').toString();
        }
        out.append('"');
        for (char c : string(value).toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 32) out.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int) c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
}
