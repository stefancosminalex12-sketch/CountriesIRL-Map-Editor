/**
 * The sticker gallery: 108 ready-made faces, each a named combination of face-maker parts.
 *
 * A preset is only the parts — eyes, brows, mouth, extras — never a colour, so the whole gallery
 * is drawn in whichever colour the author picks, and every face can be opened in the face maker
 * to change. Original artwork throughout: these are expressions built from `faceMaker.ts`.
 */
import type { BrowId, ExtraId, EyeId, FaceOptions, MouthId } from './faceMaker'

export interface FacePreset {
  id: string
  name: string
  eyes: EyeId
  brows: BrowId
  mouth: MouthId
  extras: ExtraId[]
}

type Row = [name: string, eyes: EyeId, brows: BrowId, mouth: MouthId, extras?: ExtraId[]]

const ROWS: Row[] = [
  ['Grinning', 'round', 'calm', 'grin'],
  ['Big Laugh', 'happy', 'raised', 'laugh'],
  ['Tears of Joy', 'squint', 'raised', 'laugh', ['tears']],
  ['Trying Not To Laugh', 'closed', 'raised', 'puff', ['blush']],
  ['Smug', 'smug', 'suspicious', 'smirk'],
  ['Checking You Out', 'smug', 'suspicious', 'smirk', ['point']],
  ['Side Eye', 'side', 'calm', 'flat'],
  ['Suspicious', 'side', 'angry', 'flat'],
  ['Eye Roll', 'rolling', 'none', 'flat'],
  ['Unimpressed', 'tired', 'none', 'flat'],
  ['Bored', 'tired', 'worried', 'flat'],
  ['Sleepy', 'closed', 'none', 'flat', ['zzz']],
  ['Exhausted', 'tired', 'worried', 'wobbly', ['sweat']],
  ['Angry', 'angry', 'angry', 'frown'],
  ['Furious', 'angry', 'angry', 'grit', ['anger']],
  ['Rage', 'squint', 'angry', 'shout', ['anger', 'steam']],
  ['Fire Punch', 'angry', 'angry', 'grit', ['firePunch']],
  ['Fuming', 'angry', 'angry', 'grimace', ['steam']],
  ['Grumpy', 'angry', 'thick', 'frown'],
  ['Annoyed', 'side', 'angry', 'flat', ['anger']],
  ['Sad', 'sad', 'worried', 'frown'],
  ['Crying', 'sad', 'worried', 'frown', ['tears']],
  ['Sobbing', 'squint', 'worried', 'shout', ['tears']],
  ['Puppy Eyes', 'puppy', 'worried', 'wobbly'],
  ['Pleading', 'puppy', 'worried', 'oh'],
  ['Disappointed', 'tired', 'worried', 'frown'],
  ['Thumbs Down', 'tired', 'angry', 'frown', ['thumbsDown']],
  ['Thumbs Up', 'joy', 'calm', 'smile', ['thumbsUp']],
  ['Approved', 'wink', 'calm', 'grin', ['thumbsUp']],
  ['Waving', 'happy', 'raised', 'grin', ['wave']],
  ['Hello', 'round', 'raised', 'smile', ['wave']],
  ['Peace', 'wink', 'calm', 'tongue', ['peace']],
  ['Shrug', 'side', 'raised', 'flat', ['shrug']],
  ['Whatever', 'rolling', 'raised', 'smirk', ['shrug']],
  ['Facepalm', 'closed', 'worried', 'frown', ['facepalm']],
  ['Salute', 'round', 'calm', 'smile', ['salute']],
  ['Thinking', 'side', 'suspicious', 'flat', ['think']],
  ['Hmm', 'rolling', 'suspicious', 'wobbly', ['think']],
  ['Idea', 'wide', 'raised', 'grin', ['bulb']],
  ['Confused', 'side', 'worried', 'wobbly', ['question']],
  ['Shocked', 'wide', 'raised', 'oh'],
  ['Surprised', 'wide', 'raised', 'wow'],
  ['Scared', 'wide', 'worried', 'grimace', ['sweat']],
  ['Terrified', 'wide', 'worried', 'shout', ['sweat']],
  ['Panic', 'crazy', 'worried', 'shout', ['sweat', 'exclaim']],
  ['Nervous', 'round', 'worried', 'wobbly', ['sweat']],
  ['Awkward', 'side', 'worried', 'grimace', ['sweat']],
  ['Heavy Breathing', 'wide', 'raised', 'puff', ['sweat', 'nose']],
  ['Embarrassed', 'closed', 'worried', 'smile', ['blush', 'sweat']],
  ['Shy', 'joy', 'worried', 'smile', ['blush']],
  ['In Love', 'hearts', 'calm', 'grin', ['blush']],
  ['Love Struck', 'hearts', 'raised', 'laugh', ['floatHearts']],
  ['Kiss', 'closed', 'calm', 'kiss', ['blush', 'floatHearts']],
  ['Blowing a Kiss', 'wink', 'calm', 'kiss', ['floatHearts']],
  ['Rose in Teeth', 'smug', 'suspicious', 'teeth', ['rose']],
  ['Flirty', 'wink', 'suspicious', 'smirk', ['blush']],
  ['Cool', 'round', 'calm', 'smirk', ['shades']],
  ['Hold Up', 'side', 'suspicious', 'flat', ['shades', 'point']],
  ['Boss', 'round', 'calm', 'smile', ['shades', 'crown']],
  ['King', 'smug', 'raised', 'smirk', ['crown']],
  ['Party', 'happy', 'raised', 'laugh', ['partyHat', 'sparkles']],
  ['Celebrate', 'joy', 'raised', 'grin', ['partyHat']],
  ['Star Struck', 'stars', 'raised', 'laugh', ['sparkles']],
  ['Amazed', 'stars', 'raised', 'oh'],
  ['Rich', 'money', 'raised', 'sly'],
  ['Money Eyes', 'money', 'raised', 'grin', ['sparkles']],
  ['Greedy', 'money', 'angry', 'sly'],
  ['Dizzy', 'dizzy', 'worried', 'oh'],
  ['Hypnotized', 'spiral', 'none', 'flat'],
  ['Crazy', 'crazy', 'raised', 'tongue'],
  ['Goofy', 'crazy', 'suspicious', 'laugh'],
  ['Silly', 'wink', 'raised', 'tongue'],
  ['Tongue Out', 'happy', 'calm', 'tongue'],
  ['Cheeky', 'wink', 'suspicious', 'tongue', ['blush']],
  ['Yummy', 'joy', 'raised', 'tongue', ['blush']],
  ['Drooling', 'wide', 'raised', 'drool'],
  ['Zipped', 'round', 'calm', 'zip'],
  ['Secret', 'side', 'suspicious', 'zip'],
  ['Speechless', 'wide', 'none', 'flat'],
  ['Grimace', 'round', 'worried', 'grimace'],
  ['Cringe', 'squint', 'worried', 'grimace'],
  ['Lip Bite', 'smug', 'calm', 'bite'],
  ['Mischief', 'smug', 'angry', 'sly'],
  ['Evil Grin', 'angry', 'angry', 'sly'],
  ['Sly', 'side', 'suspicious', 'sly'],
  ['Feeling Sick', 'tired', 'worried', 'oh', ['sweat']],
  ['Hurt', 'squint', 'worried', 'grimace', ['bandage']],
  ['Angel', 'joy', 'calm', 'smile', ['halo']],
  ['Innocent', 'round', 'raised', 'smile', ['halo', 'blush']],
  ['Nerd', 'round', 'raised', 'teeth', ['glasses']],
  ['Smart', 'smug', 'calm', 'smirk', ['glasses']],
  ['Fancy', 'round', 'raised', 'smile', ['monocle', 'mustache']],
  ['Gentleman', 'smug', 'calm', 'smirk', ['mustache']],
  ['Music', 'closed', 'calm', 'smile', ['headphones', 'notes']],
  ['DJ', 'happy', 'raised', 'laugh', ['headphones']],
  ['Whistling', 'side', 'calm', 'whistle', ['notes']],
  ['Innocent Whistle', 'rolling', 'raised', 'whistle'],
  ['Shout', 'angry', 'angry', 'shout'],
  ['Yelling', 'squint', 'angry', 'shout', ['exclaim']],
  ['Wow', 'wide', 'raised', 'wow', ['exclaim']],
  ['What?', 'crazy', 'raised', 'wow', ['question']],
  ['Pouting', 'side', 'angry', 'kiss'],
  ['Determined', 'angry', 'angry', 'flat', ['fist']],
  ['Strong', 'joy', 'angry', 'grin', ['fist']],
  ['Winner', 'happy', 'raised', 'grin', ['crown', 'sparkles']],
  ['Hero', 'smug', 'raised', 'smile', ['sparkles']],
  ['Chill', 'tired', 'calm', 'smile', ['shades']],
  ['Out of It', 'spiral', 'worried', 'tongue'],
]

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const FACE_PRESETS: FacePreset[] = ROWS.map(([name, eyes, brows, mouth, extras = []]) => ({
  id: slug(name),
  name,
  eyes,
  brows,
  mouth,
  extras,
}))

/** A preset as face-maker options, in `color`. */
export function presetFace(preset: FacePreset, color: string): FaceOptions {
  return { color, eyes: preset.eyes, brows: preset.brows, mouth: preset.mouth, extras: [...preset.extras], outline: false }
}
