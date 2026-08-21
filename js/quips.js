// What the enemy king says in the speech bubble: once when a fight opens,
// and again whenever the balance swings hard enough for either side to
// notice. Bosses get their own voice; everything else falls back to its
// theme's pool, and anything without a theme falls back further still.

const THEME_QUIPS = {
  banner: {
    open: ['Column formation. Hold the line.', 'Eyes front. We drill for this.', 'Standard up. Move as one.'],
    favor: ['The line holds. Yours doesn’t.', 'Discipline wins wars. Watch.', 'Formation intact. Yours is not.'],
    against: ['Ranks… break. Hold! Hold—', 'The standard falls. Reform!', 'This was not drilled for.'],
  },
  beast: {
    open: ['Grrr. Come closer.', 'Fresh meat on the board.', '*a low growl*'],
    favor: ['Smell that? That’s fear.', 'Wounded prey moves slow.', '*bares teeth*'],
    against: ['*a pained snarl*', 'This… hurts.', 'Retreat is not in me.'],
  },
  camel: {
    open: ['The desert is patient. So am I.', 'Long road. Slow steps. Sure feet.', 'Trade you a fair fight.'],
    favor: ['The caravan outlasts the storm.', 'Patience is a weapon too.', 'You rush. I do not.'],
    against: ['The sands shift against me.', 'Even camels stumble.', 'This crossing was ill-planned.'],
  },
  court: {
    open: ['Kneel, or don’t. It changes nothing.', 'A commoner, at my table.', 'You may begin.'],
    favor: ['As expected of the lesser piece.', 'The throne does not tremble.', 'Know your place.'],
    against: ['Impossible. I am the crown.', 'This… will not be forgotten.', 'You dare?'],
  },
  duck: {
    open: ['Quack. Also, good luck.', 'Mind the duck. It bites.', 'Two rules: don’t die, mind the duck.'],
    favor: ['The duck approves of this.', 'Quack quack. That means ‘winning.’', 'Even the duck is smug now.'],
    against: ['The duck is judging me.', 'This is NOT going to plan. Quack.', 'Somebody move the duck. Wait—'],
  },
  flame: {
    open: ['Everything I touch burns. Sit tight.', 'Bring water. You’ll need it.', 'Let’s see how you like the heat.'],
    favor: ['Ash. That’s all that’s left of your plan.', 'Burn it all down.', 'The fire spreads. So does the damage.'],
    against: ['Doused. How— how am I doused?', 'The flame… gutters.', 'No. NO. Not like this.'],
  },
  grave: {
    open: ['Death is patient. I am death’s patience.', 'You’ll join the others soon enough.', 'Dig two. One’s for you.'],
    favor: ['The grave welcomes another.', 'Cold hands. Colder odds.', 'You’re already halfway buried.'],
    against: ['Even the dead can be undone, it seems.', 'Rest was supposed to be MY business.', 'This body… fails me. Fine. Take it.'],
  },
  ice: {
    open: ['Cold calculation. Nothing more.', 'Stand still. It’s warmer that way.', 'Let’s freeze this in place.'],
    favor: ['Frozen solid. Predictable.', 'The ice does not forgive mistakes.', 'You’re slowing down. I can tell.'],
    against: ['Cracks. In the ice. In the plan.', 'This was not… calculated.', 'The thaw comes early.'],
  },
  volley: {
    open: ['Range found. Firing at will.', 'Stay in the open. Please.', 'I don’t need to get close to win.'],
    favor: ['Another clean shot.', 'Distance is undefeated.', 'You can’t reach what you can’t catch.'],
    against: ['They’re… inside my range now.', 'Reload. RELOAD—', 'Too close. This is too close.'],
  },
  wisp: {
    open: ['You smell of the living. How rare.', 'I have watched a thousand of these. Begin.', 'Whisper your first move. I already know it.'],
    favor: ['As it was always going to go.', 'You struggle prettily. Still struggling.', 'The pattern repeats. You lose.'],
    against: ['This… was not foreseen.', 'The pattern… breaks?', 'Impossible. I have seen every ending. Not this one.'],
  },
};

const DEFAULT_QUIPS = {
  open: ['Let’s begin.', 'Your move first, then mine.', 'Set the board.'],
  favor: ['This is going well for me.', 'I like my chances here.', 'Keep struggling.'],
  against: ['This isn’t going as planned.', 'You’re better than I expected.', 'Hm. Not bad.'],
};

const BOSS_QUIPS = {
  steward: {
    open: ['Numbers lie. Position doesn’t.', 'A thin line, but MY line.', 'The Steward does not yield ground.'],
    favor: ['You see? Position over numbers.', 'The thin line holds after all.', 'Every square, accounted for.'],
    against: ['The thin line… thins further.', 'This was not the arrangement I planned.', 'Reinforcements! …there are none.'],
  },
  marshal: {
    open: ['I’ve studied every game you’ve played to get here.', 'Let’s see if you’re as good as the road says.', 'The Marshal does not lose twice to the same trick.'],
    favor: ['Exactly as calculated.', 'You’re playing my game now.', 'I told you I’d studied you.'],
    against: ['…you weren’t in the notes.', 'A gap in my preparation. Noted.', 'Impressive. Genuinely.'],
  },
  quartermaster: {
    open: ['I don’t leave the fort. Come to me.', 'Siege me. I have all day.', 'The fort has never fallen. Neither will I.'],
    favor: ['The walls hold. As they always have.', 'Come closer. The fort likes company.', 'Patience wins sieges.'],
    against: ['The fort… the fort is breached?', 'No siege has ever— this is new.', 'Hold. HOLD. …hold?'],
  },
  warden: {
    open: ['Nothing gets past this gate. Especially not you.', 'The gate is mine to keep. Try me.', 'Duty is a fire that doesn’t go out.'],
    favor: ['The gate holds. My duty, unbroken.', 'You won’t get past me. No one does.', 'This is what the gate is for.'],
    against: ['The gate… the gate is failing.', 'I was sworn to hold this. I am failing my oath.', 'Not on my watch. NOT on my watch.'],
  },
  rimeguard: {
    open: ['We are the only cold that matters here.', 'Two of us. One purpose.', 'Step carefully. We do not thaw.'],
    favor: ['We advance as one. You cannot.', 'The frost spreads. We are patient.', 'Together, we are unbroken.'],
    against: ['We… one of us falters.', 'The ice — our ice — it cracks.', 'We were never meant to stand alone.'],
  },
  collector: {
    open: ['I have one of everything you own. And more.', 'Every piece here, I chose personally.', 'My collection is about to grow by one king.'],
    favor: ['Another fine addition to the collection.', 'You see the range of my collection now.', 'Everything has its use. Even you, soon.'],
    against: ['My collection… incomplete after all?', 'I did not curate for THIS.', 'Perhaps I collected wrong.'],
  },
  throne: {
    open: ['Every king before you has knelt here.', 'The throne has never been taken. It will not start today.', 'You’ve come far. It ends here regardless.'],
    favor: ['The throne remembers every challenger. Yours will be brief.', 'This is how it always ends for your kind.', 'Kneel. It would be easier.'],
    against: ['The throne… trembles?', 'This has NEVER happened.', 'I am the THRONE. I do not—'],
  },
  conflagration: {
    open: ['Everything burns eventually. I simply hurry it along.', 'You are standing in my path. That is unwise.', 'The fire remembers nothing. Neither will you.'],
    favor: ['The board is ash. As intended.', 'Nothing survives the path I walk.', 'Burn.'],
    against: ['The fire… gutters against you?', 'Nothing douses me. NOTHING.', 'This is not how fire behaves.'],
  },
  archivist: {
    open: ['I have a record of every piece you’ve ever fielded.', 'I remember every game you’ve played to reach me.', 'Let’s see what the archive has prepared for you.'],
    favor: ['Page after page, all predicting this.', 'Your patterns are catalogued. And countered.', 'I’ve read this game before you played it.'],
    against: ['This page… is blank. That has never happened.', 'No record. No precedent. Fascinating. And troubling.', 'I need to revise my archive.'],
  },
  gravetide: {
    open: ['I don’t need an army. I’ll use yours.', 'Every piece you lose here, I keep.', 'The tide does not ask permission.'],
    favor: ['Your fallen already serve me.', 'The tide rises. It always rises.', 'Soon this whole board is mine, piece by piece.'],
    against: ['The tide… recedes?', 'That has never — mine do not fall.', 'This is not how the tide behaves.'],
  },
};

/** One distinctive line per elite at fight start; favor/against fall back to theme. */
const ELITE_OPEN = {
  pond: 'Mind the duck. It’s judging your opening.',
  outpost: 'Long legs, longer patience. Begin.',
  icebox: 'Cold in here. Get used to it.',
  flame: 'I don’t put out fires. I start them.',
  vault: 'Behind these walls, I keep what matters. You’re not getting in.',
  nave: 'The aisle is narrow. So are your options.',
  shepherd: 'The flock moves as I say. So will you.',
  hoard: 'She forks. You bleed. Simple as that.',
  keeper: 'Twelve points of trouble, and an escort besides.',
  hierophant: 'The board is open. So is your king, eventually.',
  drillyard: 'Everything under my standard moves as one. Watch.',
  longbarrow: 'What I raise, I raise shielded. Should’ve killed me first.',
  enfilade: 'Three lines of fire. Pick one to die in.',
  marshalcy: 'Two standards. Everything beneath them moves like a king.',
};

/**
 * A line for the given category ('open' | 'favor' | 'against'), or null if
 * there is nothing to say. `rng` should be the run's own seeded generator so
 * the choice stays part of the run's determinism, but falls back to
 * Math.random for callers (like sandbox previews) that have no run.
 */
export function pickQuip(encounter, category, rng = Math.random) {
  if (!encounter) return null;
  const boss = BOSS_QUIPS[encounter.id];
  if (boss?.[category]?.length) {
    return boss[category][Math.floor(rng() * boss[category].length)];
  }
  if (category === 'open' && ELITE_OPEN[encounter.id]) {
    return ELITE_OPEN[encounter.id];
  }
  const theme = THEME_QUIPS[encounter.theme];
  const lines = (theme?.[category]?.length ? theme[category] : DEFAULT_QUIPS[category]) || [];
  if (!lines.length) return null;
  return lines[Math.floor(rng() * lines.length)];
}
