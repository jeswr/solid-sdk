/** Encode raw bytes as an unpadded base64url string. */
export declare function bytesToBase64url(bytes: Uint8Array): string;
/**
 * Decode an unpadded base64url string to its raw bytes.
 * @throws if the input contains characters outside the base64url alphabet.
 */
export declare function base64urlToBytes(value: string): Uint8Array;
/** Encode a UTF-8 string as base64url (no padding). */
export declare function encodeBase64url(text: string): string;
/**
 * Decode a base64url string to its UTF-8 contents.
 * @throws if the input is not valid base64url or not valid UTF-8.
 */
export declare function decodeBase64url(token: string): string;
//# sourceMappingURL=base64url.d.ts.map