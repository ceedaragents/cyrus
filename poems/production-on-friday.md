# Production on Friday

```yaml
deploy:
  schedule: "0 17 * * FRI"  # Every Friday at 5pm
  # What could go wrong?
```

It's Friday afternoon,
code reviews done soon,
"Should we deploy?" they ask,
seems like a simple task.

"The tests are all green,"
cleanest code I've seen,
"It's just a small change,"
nothing seems strange.

I click the button,
feeling like glutton,
for tempting fate,
at this late date.

The deploy starts,
across all parts,
minutes tick away,
end of the workday.

Status: SUCCESS,
no need to stress,
I close my laptop,
weekend won't stop.

---

*Saturday, 2 AM*

My phone starts ringing,
alerts are singing,
PagerDuty screams,
shattering dreams.

"Error rate spiking,"
this isn't to my liking,
"Users can't login,"
my head is spinning.

I grab my computer,
become the shooter,
of bugs and flames,
weekend in flames.

Rollback attempted,
but that's rejected,
migrations ran,
no backup plan.

I dig through logs,
through error fogs,
find the issue there,
a null somewhere.

The fix takes hours,
coffee empowers,
by dawn it's stable,
as much as I'm able.

Monday arrives,
team high-fives,
"Great work this weekend!"
(my sanity's weakened).

And so I learned,
bridges I burned,
never deploy on Friday,
unless you want to cry all day.

Now when Friday comes,
I bite my thumbs,
"Let's wait 'til Monday,"
that's the right way.
