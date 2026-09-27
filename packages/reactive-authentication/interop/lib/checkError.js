/** A failed harness check. Its messages are written by the harness and never embed sensitive values. */
export class CheckError extends Error {
    name = "CheckError"
}
