# The Khapee website

An interactive short film rather than a landing page. The visitor scrolls, and
the scroll is the timeline: somebody orders on the way, the kitchen starts
while they travel, and the two finish together.

Separate from the app on purpose — nothing here talks to a server, and nothing
here can break ordering.

## Running it

```
npm install
npm run dev      # http://localhost:5290
npm run build    # static files into dist/
```

React + TypeScript + Tailwind, Framer Motion for the timelines, Lenis for
smooth scroll. `dist/` is plain files and will sit on any host.

## How the film works

Every scene is a tall `<section>` with a `position: sticky` stage inside it.
Scrolling through the section does not move the stage — it advances one number
from 0 to 1, and everything on that stage is a function of that number. That is
the whole architecture (`src/lib/scene.ts`), and it is why the result reads as
continuous footage rather than a stack of slides: there is no moment where one
thing ends and another begins, only a timeline being scrubbed.

- `useScene(lengthVh)` — the clock. `lengthVh` is how much scrolling a scene is
  worth, and it is the pace control worth tuning by feel.
- `useCue(t, from, to)` — one beat's slice of that clock, as its own 0→1.
- `<Shot>` — a picture that fades in, holds and fades out, with a camera move.
- `<Cue>` / `<Line>` — words, on their own beat.

The beat that matters is in `Drive`: the customer arrives and the plate lands
together. That coincidence is the argument, so the two are tuned against each
other rather than written independently.

## Design notes, and four things that were wrong

Worth reading before changing the look, because each of these was arrived at
by getting it wrong first.

**Not a soft glow.** The first version lit every scene with a radial gradient
behind the subject. That is the single most generated-looking object on the
web. There are no gradients anywhere in this page now — light is a flat band
of colour with a straight edge, the way a screen print adds a second colour.

**Not one accent on black.** Near-black with a single amber highlight is the
house style of every AI-made product page. The scenes are deep aubergine, pine,
brick and rust, one per chapter, with gold and terracotta as the only accents.

**Not a system serif.** Huge Georgia-ish headlines are the other half of that
same house style. Bricolage Grotesque has deliberate irregularity in the
letterforms — off in the way a person draws and a machine does not — over
Space Grotesk for everything else.

**Not a column of copy beside a picture.** That was tried and it stopped being
a film the moment it appeared: it read as a landing page with an animation on
it. The picture holds the frame and words arrive over it in sequence.

Grain sits over the whole page at 13%. Flat vector on flat colour is
mathematically perfect and reads as such; real printed colour has noise in it.

## The cast

`src/components/Figure.tsx`. One construction everywhere, so the person in the
car and the person at the counter are the same species of drawing. Expressions
are built from transforms — lids sliding down, brows tilting, a mouth scaling
through flat into a smile — rather than from swapping drawings, because a
transform can be halfway and halfway is where the acting is.

`mood` runs 0 to 1: hungry and tired, through neutral, to genuinely pleased.

## The phone

`src/components/Phone.tsx` holds ten states of the real ordering flow, used two
ways: driven by the scroll clock inside a scene, and driven by taps in the demo
section. One component both times, so the two can never drift apart.
