// Parts of the SSH library use Node's global `Buffer`; in the browser build it is the `buffer` package's.
export { Buffer } from "buffer";
