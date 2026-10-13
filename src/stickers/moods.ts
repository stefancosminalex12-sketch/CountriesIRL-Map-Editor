/**
 * Moods: the nine levels a country can be on, from the very best to the very worst, each a colour
 * of the sticker colour row and a group of gallery faces that look the part.
 *
 * The colours are `FACE_COLORS` in its own order — light blue, blue, lime, yellow, orange, red,
 * purple, gray, black — so a face recoloured from its right-click menu lands on exactly the
 * colours the moods use, and the **Moods** data palette (`state/palettes.ts`) is these nine,
 * worst first, the way every ramp runs lowest first.
 *
 * With Moods on (`StickerMode.moods`), every country with a number wears a face from its mood's
 * group, in its mood's colour: which mood comes from the same scale that colours the country, and
 * which face from the group is a coin toss seeded by the country and `StickerMode.moodSeed`, so a
 * country keeps its face while the author works and Shuffle deals new ones.
 *
 * Every gallery face is in exactly one group. One left out is drawn in Meh rather than lost.
 */
import { FACE_COLORS } from './faceMaker'
import { FACE_PRESETS } from './facePresets'

export interface Mood {
  id: string
  name: string
  /** What the level means, for the panel. */
  level: string
  color: string
  /** Gallery face ids (`FacePreset.id`). */
  faces: string[]
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Best first. Faces by their gallery names. */
const GROUPS: Array<[id: string, name: string, level: string, faces: string[]]> = [
  ['starstruck', 'Starstruck', 'The very best', [
    'Impressed with Stars In Eyes', 'Star Struck', 'Amazed', 'Wow', 'Party', 'Winner', 'Hero',
    'King', 'Boss', 'Rich', 'Money Eyes', 'Angel', 'Head Over Heels', 'In Love', 'Love Struck',
    'Love from the Heart', 'Heart Hands', 'Love You', 'Finger Heart', 'Very Touched',
  ]],
  ['joyful', 'Joyful', 'Really good', [
    'Big Laugh', 'Tears of Joy', 'Pointing And Laughing In Tears', 'Laughing It Off', 'Snickering',
    'Trying Not To Laugh', 'Beaming', 'Huge Grin', 'Happy and Cheering', 'Celebrate', 'Clapping',
    'Double Thumbs Up', 'Rock On', 'Strong', 'DJ', 'Music', 'Give Me A Hug', 'Kiss', 'Blowing a Kiss',
    'Red Lips Kiss', 'Offering a Rose', 'Flattered', 'Yummy',
  ]],
  ['happy', 'Happy', 'Good', [
    'Grinning', 'Contented Grin', 'Thumbs Up', 'Approved', 'OK Sign', 'Wink', 'Cool', 'Chill',
    'Wearing Shades', 'Smiling Face with Sunglasses', 'Waving Hello', 'Waving', 'Hello', 'Peace',
    'Fist Bump', 'Call Me', 'I Choose You', 'Salute', 'Determined', 'Idea', 'Nerd', 'Smart', 'Fancy',
    'Gentleman', 'Whistling', 'Innocent', 'Innocent and Pretty', 'Cat Face', 'Cookie Muncher',
    'Drooling', 'Knowing Smirk', 'Sneaky Grin', 'Checking You Out', 'Rose in Teeth', 'Flirty',
    'Sexy Biting Lip', 'Lip Bite', 'Tongue Out', 'Raspberry', 'Cheeky', 'Silly', 'Goofy', 'Wacky Face',
    'Derp', 'Crazy', 'Troll Face',
  ]],
  ['meh', 'Meh', 'Kind of meh', [
    'Shrug', 'Whatever', 'Not Impressed', 'Unimpressed', 'Bored', 'Blank Smile', 'Speechless',
    'Side Eye', 'Smug', 'Smug Side-Eye', 'Sly', 'Mischief', 'Suspicious', 'Suspicious Eye',
    'Suspicious Heavy-Lidded', 'Eye Roll', 'Thinking', 'Thinking Face', 'Hmm', 'Taking Notes',
    'Hold On', 'Hold Up', 'Down There', 'Gimme', 'Zipped', 'Secret', 'Hush', 'Innocent Whistle',
    'Sleepy', 'Sleepy and Yawning', 'Mewing', 'Ooh Face', 'Surprised', 'What?', 'Dumbfound',
    'Hypnotized', 'Out of It',
  ]],
  ['uneasy', 'Uneasy', 'Kind of bad', [
    'Nervous', 'Nervous Sweat', 'Heavy Breathing', 'Awkward', 'Awkward Laugh', 'Embarrassed', 'Shy',
    'Confused', 'Oops', 'Worried', 'Grimace', 'Cringe', 'Yikes', 'Appalled', 'Shock', 'Shocked',
    'Scared', "Can't Look and Too Scared", 'Face Palm', 'Facepalm', 'Please', 'Pretty Please',
    'Just A Tiny Bit', 'Batter Up',
  ]],
  ['angry', 'Angry', 'Bad', [
    'Angry', 'Grumpy', 'Annoyed', 'Fuming', 'Growling Mad', 'Shout', 'Yelling', 'Making an Argument',
    'Fire Punch', 'Thumbs Down', 'Nope', 'Stop Right There', 'Unamused Face', 'Displeased', 'Pouting',
    'Evil Smirk', 'Evil Grin', 'Devious', 'Greedy',
  ]],
  ['sad', 'Sad', 'Really bad', [
    'Sad', 'Disappointed', 'Tearing Up', 'Sad and Silently Crying', 'Crying', 'Puppy Eyes',
    'Big Puppy Eyes', 'Pleading', 'Pleading Eyes', 'Fading Away',
  ]],
  ['miserable', 'Miserable', 'Terrible', [
    'Sobbing', 'Bawling', 'Desperate', 'Exhausted', 'Feeling Sick', 'Seasick Smiley', 'Woozy Face',
    'Dizzy', 'Hot Face', 'Hurt', 'Punched in Face Black-Eye',
  ]],
  ['doomed', 'Doomed', 'The very worst', [
    'Rage', 'Furious', 'Mouth Open in Rage', 'Roaring Angry Beast', 'Terrified', 'Panic', 'In Shock',
    "Can't Unsee This", 'Instant Regret with Hands on Head', 'Thousand-Yard Stare',
  ]],
]

const MEH = 3
const known = new Set(FACE_PRESETS.map((p) => p.id))
const placed = new Set(GROUPS.flatMap(([, , , faces]) => faces.map(slug)))

/** The nine moods, best first: index 0 is the very best, index 8 the very worst. */
export const MOODS: Mood[] = GROUPS.map(([id, name, level, faces], i) => ({
  id,
  name,
  level,
  color: FACE_COLORS[i].color,
  faces: [
    ...faces.map(slug).filter((face) => known.has(face)),
    ...(i === MEH ? FACE_PRESETS.filter((p) => !placed.has(p.id)).map((p) => p.id) : []),
  ],
}))

/** Which mood a rung of `rungs` (0 = lowest value) is, given which end of the data is good. */
export function moodForRung(rung: number, rungs: number, lowerIsBetter: boolean): number {
  const last = MOODS.length - 1
  const position = rungs <= 1 ? 1 : rung / (rungs - 1)
  const fromBest = Math.round((lowerIsBetter ? position : 1 - position) * last)
  return Math.min(last, Math.max(0, fromBest))
}

/** A whole number from a string, the same every time: FNV-1a. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The face from mood `mood`'s group that entity `entityId` wears under `seed`. */
export function moodFace(mood: number, entityId: string, seed: number): string {
  const faces = MOODS[mood].faces
  return faces[hash(`${entityId}:${seed}`) % faces.length]
}
