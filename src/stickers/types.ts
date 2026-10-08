/** One image that can be put on the map. */
export interface Sticker {
  /** `builtin:…` for the faces that ship with the editor, `user:…` for an upload. */
  id: string
  name: string
  /** The artwork as a `data:` URI, so it is inside every export. */
  src: string
  builtin?: boolean
  /**
   * Where a stored sticker came from: a file the author uploaded, or one they made in Create.
   * Absent on built-in faces, on emoji picked for the session, and on stickers stored before
   * this was recorded.
   */
  origin?: 'upload' | 'made'
}
