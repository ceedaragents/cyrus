# Merge Conflicts

```bash
git merge feature-branch
# CONFLICT (content): Merge conflict in app.js
```

I pulled the latest main,
here comes the pain,
those angle brackets appear,
filling me with fear.

```
<<<<<<< HEAD
const value = getNewValue();
=======
const value = fetchValue();
>>>>>>> feature-branch
```

Which one is right?
I code through the night,
checking git blame,
finding names to claim.

"Who wrote this line?"
(Oh wait, it's mine),
from three weeks ago,
when I didn't know.

I ask in Slack,
waiting for them back,
but they're on vacation,
no documentation.

So I pick and choose,
either way I lose,
keep both? Keep neither?
This couldn't be either easier.

Finally resolved,
my courage evolved,
I stage and commit,
(and instantly regret it).

The tests turn red,
I hang my head,
both versions were wrong,
all along.

So here's my advice,
merge often, be nice,
small PRs daily,
prevents conflicts mainly.

But we both know,
as codebases grow,
we'll meet again here,
angle brackets we'll fear.
