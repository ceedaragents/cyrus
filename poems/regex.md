# Regex: The Arcane Art

```javascript
const pattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
// I wrote this yesterday and already don't understand it
```

Some people, when confronted with a problem,
think "I know, I'll use regex,"
now they have two problems,
and one's complex.

I need to validate email,
simple detail,
how hard could it be?
Let's see...

Start with: `/.+@.+\..+/`
feeling free,
that should do,
test it through.

Wait, it accepts: `a@b.c`,
technically,
valid but wrong,
not very strong.

Add more rules: `/^\w+@\w+\.\w+$/`
feeling cool,
but now it fails,
for emails with details.

What about plus signs?
And hyphen lines?
Dots in the name?
This regex game...

Hours later, I've got:
```
/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
```
looks like a bot,
wrote a lot.

Test it carefully,
thoroughfully,
but edge cases remain,
causing pain.

Someone suggests:
"Check the RFC,"
2000 lines of test,
I'm not free.

Or try to parse HTML,
that way lies hell,
regex can't do,
nested things true.

But passwords to validate?
Easy fate:
```
/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}$/
```
(wait, what?)

Lookaheads and lookbehinds,
blow my mind,
capturing groups,
going through loops.

Non-capturing with `?:`,
why oh why,
greedy vs lazy,
driving me crazy.

Escape the special chars,
behind bars,
`\.` `\*` `\?` `\\`,
slashes galore, pure hell.

Test on regex101,
where I run,
color-coded guide,
saving my hide.

Six hours spent,
time hell-bent,
to match a phone,
should've used a library shown.

But I persist,
can't resist,
the regex way,
though hair turns gray.

For when it works,
with all its quirks,
one line of code,
carries the load.

Powerful and terse,
universe,
of pattern matching glory,
regex's story.

Just remember this rule,
useful tool:
comment your regex well,
or future you'll dwell in hell.
