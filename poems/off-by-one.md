# Off By One

```python
for i in range(len(array)):
    # Is it < or <=?
    # Does range include the end?
    # Why does this always confuse me?
```

There are two hard problems in CS,
naming things and off-by-one errors, I confess,
(and also counting to three,
but that's just me).

Zero-indexed arrays,
cause me always delays,
array[0] is first,
memory cursed.

Need the last element?
I implement,
array[length],
my code's strength.

IndexError appears,
confirming my fears,
it's length minus one,
elementary, son.

Try a for loop next,
I'm perplexed,
```python
for i in range(0, n):
```
does that include n?

No, it stops before,
that's the core,
range(5) gives 0-4,
nothing more.

So I write range(n+1),
thinking I've won,
now I'm too far,
broke the car.

Off by one again,
this refrain,
happens every time,
coding's crime.

Slice operations too,
make me blue,
array[start:end],
I can't comprehend.

Is end included?
My brain's deluded,
check the docs once more,
(it's exclusive, for sure).

Fencepost problems haunt,
they taunt,
ten posts need nine gaps,
mathematical traps.

Border conditions bite,
day and night,
edge cases galore,
right at the door.

N minus one? N? N plus one?
Never done,
guessing each time,
debugging's climb.

So here's my shame,
I claim,
after years of code,
down this road:

I still count on fingers,
doubt lingers,
and use print statements,
with patience.

Because off-by-one,
is never done,
it's not a bug,
it's a feature... *shrug*
