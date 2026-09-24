# Parity report — 2026-09-24

Instance: <test-host>:28096 · user: oleksii · web HEAD: 01719e32a1 · plugin: 0.1.0.0
Bundle: 3b7675071649 (01719e32a1) · host: 12.0.0.0 · mode: full
Takeover before: {"TakeoverEnabled":true,"BundleId":"3b7675071649","state":"patched"} · after: {"state":"patched","bundleId":"3b7675071649"}

Shape: takeover · stock document: <test-host>/web-mod/3b7675071649/index.html · mod document: <test-host>/web/ · browser: chrome chromium 153.0.8010.53

| # | Area | Feature | Stock (stock entry) | Mod (/web takeover) | Verdict |
|---|------|---------|--------------|----------------|---------|
| preflight | Preflight | Same user, same views, bundle correctly rooted | ok | ok | PASS |
| A1 | Inventory | Movies total count (API, both tabs) | 55 | 55 | PASS |
| A1 | Inventory | TV total count (API, both tabs) | 105 | 105 | PASS |
| A1 | Inventory | Movies grid reported total | 55 | 55 | PASS |
| A1 | Inventory | TV grid reported total | 105 | 105 | PASS |
| A2 | Inventory | movies id set (stock vs mod), lazy-load mode paged/paged | 55 ids | 55 ids | PASS |
| A2 | Inventory | tv id set (stock vs mod), lazy-load mode paged/paged | 105 ids | 105 ids | PASS |
| A3 | Seasons/Episodes | Seasons and episodes for 40 series | match | match | PASS |
| A4 | Sort orders | Movies sort: Name Ascending | 55 ids | 55 ids | PASS |
| A4 | Sort orders | Movies sort: Date Added Descending | 55 ids | 55 ids | PASS |
| A4 | Sort orders | Movies sort: Release Date Descending | 55 ids | 55 ids | PASS |
| A4 | Sort orders | Movies sort: Community Rating Descending | 55 ids | 55 ids | PASS |
| A5 | Filters | Movies filter: Genre: Action | 6 ids | 6 ids | PASS |
| A5 | Filters | Movies filter: Year: 2025 | 9 ids | 9 ids | PASS |
| A5 | Filters | Movies filter: Played | 9 ids | 9 ids | PASS |
| A5 | Filters | Movies filter: Unplayed | 46 ids | 46 ids | PASS |
| A5 | Filters | Movies filter: Favourites | 1 ids | 1 ids | PASS |
| A6 | Collections | Movies collections tab id set | 55 ids | 55 ids | PASS |
| A6 | Collections | First boxset children | n/a | n/a | SKIPPED |
| A7 | Non-Latin titles | Non-Latin titles present | none in library | none in library | RECORDED |
| B0 | Detail sample | Sample chosen: 12 movies + 105 series | ["0040709081e66d6e20f562643b81a00f","09be82fc66ac0aa8a3a9df0450fa7406","0b112cfd083cae1722f28359797f5b65","1a0b81d432dbe0cc9efb467117cf50ac","1c3a1ac050339e228c8b6033556ff638","28f5b20511edaa6c2129d8b | same sample (data-level, both sides read the same ids) | RECORDED |
| B1 | Detail metadata | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): Title | David Beckham Infamous | David Beckham Infamous | PASS |
| B1 | Detail metadata | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): Misc info (year/runtime) | 2021 1h 11m \| | 2021 1h 11m \| | PASS |
| B1 | Detail metadata | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): Official rating |  |  | PASS |
| B1 | Detail metadata | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): Genres |  |  | PASS |
| B1 | Detail metadata | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): Overview |  |  | PASS |
| B1 | Detail metadata | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): Studios |  |  | PASS |
| B1 | Detail metadata | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): Tags |  |  | PASS |
| B2 | Artwork | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): primary image path/tag | /Items/0040709081e66d6e20f562643b81a00f/Images/Primary | /Items/0040709081e66d6e20f562643b81a00f/Images/Primary | PASS |
| B3 | Cast/crew | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): cast id sequence | 0 | 0 | PASS |
| B1 | Detail metadata | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): Title | Lessons of Tolerance | Lessons of Tolerance | PASS |
| B1 | Detail metadata | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): Misc info (year/runtime) | 2024 1h 35m 7.1 \| | 2024 1h 35m 7.1 \| | PASS |
| B1 | Detail metadata | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): Official rating |  |  | PASS |
| B1 | Detail metadata | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): Genres | Comedy, Drama | Comedy, Drama | PASS |
| B1 | Detail metadata | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): Overview | A Ukrainian LGBTQ+ acceptance group is formed by teacher Nadia. A stereotypicall | A Ukrainian LGBTQ+ acceptance group is formed by teacher Nadia. A stereotypicall | PASS |
| B1 | Detail metadata | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): Studios |  |  | PASS |
| B1 | Detail metadata | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): Tags | lgbt, social justice, gay theme, social acceptance | lgbt, social justice, gay theme, social acceptance | PASS |
| B2 | Artwork | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): primary image path/tag | /Items/09be82fc66ac0aa8a3a9df0450fa7406/Images/Primary | /Items/09be82fc66ac0aa8a3a9df0450fa7406/Images/Primary | PASS |
| B3 | Cast/crew | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): cast id sequence | 9 | 9 | PASS |
| B1 | Detail metadata | Highlander (0b112cfd083cae1722f28359797f5b65): Title | Highlander | Highlander | PASS |
| B1 | Detail metadata | Highlander (0b112cfd083cae1722f28359797f5b65): Misc info (year/runtime) | 1986 1h 57m R 6.9 70 \| | 1986 1h 57m R 6.9 70 \| | PASS |
| B1 | Detail metadata | Highlander (0b112cfd083cae1722f28359797f5b65): Official rating | R | R | PASS |
| B1 | Detail metadata | Highlander (0b112cfd083cae1722f28359797f5b65): Genres | Adventure, Action, Fantasy | Adventure, Action, Fantasy | PASS |
| B1 | Detail metadata | Highlander (0b112cfd083cae1722f28359797f5b65): Overview | He fought his first battle on the Scottish Highlands in 1536. He will fight his  | He fought his first battle on the Scottish Highlands in 1536. He will fight his  | PASS |
| B1 | Detail metadata | Highlander (0b112cfd083cae1722f28359797f5b65): Studios | Davis-Panzer Productions, Thorn EMI Screen Entertainment, Highlander Productions | Davis-Panzer Productions, Thorn EMI Screen Entertainment, Highlander Productions | PASS |
| B1 | Detail metadata | Highlander (0b112cfd083cae1722f28359797f5b65): Tags | new york city, martial arts, swordplay, immortality, scotland, sword, sword figh | new york city, martial arts, swordplay, immortality, scotland, sword, sword figh | PASS |
| B2 | Artwork | Highlander (0b112cfd083cae1722f28359797f5b65): primary image path/tag | /Items/0b112cfd083cae1722f28359797f5b65/Images/Primary | /Items/0b112cfd083cae1722f28359797f5b65/Images/Primary | PASS |
| B3 | Cast/crew | Highlander (0b112cfd083cae1722f28359797f5b65): cast id sequence | 34 | 34 | PASS |
| B1 | Detail metadata | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): Title | Highlander II: The Quickening | Highlander II: The Quickening | PASS |
| B1 | Detail metadata | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): Misc info (year/runtime) | 1991 1h 50m R 4.7 \| | 1991 1h 50m R 4.7 \| | PASS |
| B1 | Detail metadata | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): Official rating | R | R | PASS |
| B1 | Detail metadata | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): Genres | Fantasy, Action, Adventure, Science Fiction | Fantasy, Action, Adventure, Science Fiction | PASS |
| B1 | Detail metadata | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): Overview | The Prize has been won. Connor MacLeod is mortal... Now an old man on the verge  | The Prize has been won. Connor MacLeod is mortal... Now an old man on the verge  | PASS |
| B1 | Detail metadata | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): Studios | Davis-Panzer Productions, Harat Investments, Lamb Bear Entertainment, Interstar, | Davis-Panzer Productions, Harat Investments, Lamb Bear Entertainment, Interstar, | PASS |
| B1 | Detail metadata | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): Tags | new york city, martial arts, immortality, scotland, sword fight, fictional war,  | new york city, martial arts, immortality, scotland, sword fight, fictional war,  | PASS |
| B2 | Artwork | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): primary image path/tag | /Items/1a0b81d432dbe0cc9efb467117cf50ac/Images/Primary | /Items/1a0b81d432dbe0cc9efb467117cf50ac/Images/Primary | PASS |
| B3 | Cast/crew | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): cast id sequence | 20 | 20 | PASS |
| B1 | Detail metadata | Mercy (1c3a1ac050339e228c8b6033556ff638): Title | Mercy | Mercy | PASS |
| B1 | Detail metadata | Mercy (1c3a1ac050339e228c8b6033556ff638): Misc info (year/runtime) | 2026 1h 40m PG-13 7.1 \| | 2026 1h 40m PG-13 7.1 \| | PASS |
| B1 | Detail metadata | Mercy (1c3a1ac050339e228c8b6033556ff638): Official rating | PG-13 | PG-13 | PASS |
| B1 | Detail metadata | Mercy (1c3a1ac050339e228c8b6033556ff638): Genres | Science Fiction, Thriller, Crime, Mystery | Science Fiction, Thriller, Crime, Mystery | PASS |
| B1 | Detail metadata | Mercy (1c3a1ac050339e228c8b6033556ff638): Overview | In the near future, a detective stands on trial accused of murdering his wife. H | In the near future, a detective stands on trial accused of murdering his wife. H | PASS |
| B1 | Detail metadata | Mercy (1c3a1ac050339e228c8b6033556ff638): Studios | Atlas Entertainment, Amazon MGM Studios, Bazelevs | Atlas Entertainment, Amazon MGM Studios, Bazelevs | PASS |
| B1 | Detail metadata | Mercy (1c3a1ac050339e228c8b6033556ff638): Tags | trakt, watched, race against time, mission, artificial intelligence (a.i.), bomb | trakt, watched, race against time, mission, artificial intelligence (a.i.), bomb | PASS |
| B2 | Artwork | Mercy (1c3a1ac050339e228c8b6033556ff638): primary image path/tag | /Items/1c3a1ac050339e228c8b6033556ff638/Images/Primary | /Items/1c3a1ac050339e228c8b6033556ff638/Images/Primary | PASS |
| B3 | Cast/crew | Mercy (1c3a1ac050339e228c8b6033556ff638): cast id sequence | 31 | 31 | PASS |
| B1 | Detail metadata | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): Title | The Minimalists: Less Is Now | The Minimalists: Less Is Now | PASS |
| B1 | Detail metadata | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): Misc info (year/runtime) | 2021 54m 6.1 \| | 2021 54m 6.1 \| | PASS |
| B1 | Detail metadata | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): Official rating |  |  | PASS |
| B1 | Detail metadata | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): Genres |  |  | PASS |
| B1 | Detail metadata | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): Overview | They've built a movement out of minimalism. Longtime friends Joshua Fields Millb | They've built a movement out of minimalism. Longtime friends Joshua Fields Millb | PASS |
| B1 | Detail metadata | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): Studios | Booklight Productions, Catalyst Films | Booklight Productions, Catalyst Films | PASS |
| B1 | Detail metadata | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): Tags | minimalism, inspirational, intimate, factual | minimalism, inspirational, intimate, factual | PASS |
| B2 | Artwork | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): primary image path/tag | /Items/28f5b20511edaa6c2129d8b4c98eeaee/Images/Primary | /Items/28f5b20511edaa6c2129d8b4c98eeaee/Images/Primary | PASS |
| B3 | Cast/crew | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): cast id sequence | 3 | 3 | PASS |
| B1 | Detail metadata | After Porn Ends (3a3aeead9e4e7985a607380369528e40): Title | After Porn Ends | After Porn Ends | PASS |
| B1 | Detail metadata | After Porn Ends (3a3aeead9e4e7985a607380369528e40): Misc info (year/runtime) | 2012 1h 33m R 5.6 \| | 2012 1h 33m R 5.6 \| | PASS |
| B1 | Detail metadata | After Porn Ends (3a3aeead9e4e7985a607380369528e40): Official rating | R | R | PASS |
| B1 | Detail metadata | After Porn Ends (3a3aeead9e4e7985a607380369528e40): Genres |  |  | PASS |
| B1 | Detail metadata | After Porn Ends (3a3aeead9e4e7985a607380369528e40): Overview | Documentary examining what happens to some of the biggest names in the history o | Documentary examining what happens to some of the biggest names in the history o | PASS |
| B1 | Detail metadata | After Porn Ends (3a3aeead9e4e7985a607380369528e40): Studios | Oxymoron Entertainment, Mallick Media | Oxymoron Entertainment, Mallick Media | PASS |
| B1 | Detail metadata | After Porn Ends (3a3aeead9e4e7985a607380369528e40): Tags | porno, informative | porno, informative | PASS |
| B2 | Artwork | After Porn Ends (3a3aeead9e4e7985a607380369528e40): primary image path/tag | /Items/3a3aeead9e4e7985a607380369528e40/Images/Primary | /Items/3a3aeead9e4e7985a607380369528e40/Images/Primary | PASS |
| B3 | Cast/crew | After Porn Ends (3a3aeead9e4e7985a607380369528e40): cast id sequence | 17 | 17 | PASS |
| B1 | Detail metadata | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): Title | Nightbitch | Nightbitch | PASS |
| B1 | Detail metadata | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): Misc info (year/runtime) | 2024 1h 40m R 5.7 59 \| | 2024 1h 40m R 5.7 59 \| | PASS |
| B1 | Detail metadata | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): Official rating | R | R | PASS |
| B1 | Detail metadata | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): Genres | Comedy, Horror | Comedy, Horror | PASS |
| B1 | Detail metadata | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): Overview | A woman, thrown into the stay-at-home routine of raising a toddler in the suburb | A woman, thrown into the stay-at-home routine of raising a toddler in the suburb | PASS |
| B1 | Detail metadata | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): Studios | Annapurna Pictures, Bond Group Entertainment, Defiant By Nature, Archer Gray | Annapurna Pictures, Bond Group Entertainment, Defiant By Nature, Archer Gray | PASS |
| B1 | Detail metadata | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): Tags | based on novel or book, melancholy, satire, magic realism, metamorphosis, suburb | based on novel or book, melancholy, satire, magic realism, metamorphosis, suburb | PASS |
| B2 | Artwork | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): primary image path/tag | /Items/597ef4ff35d608fb98b4ad8fc60a7253/Images/Primary | /Items/597ef4ff35d608fb98b4ad8fc60a7253/Images/Primary | PASS |
| B3 | Cast/crew | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): cast id sequence | 23 | 23 | PASS |
| B1 | Detail metadata | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): Title | Oh Mom! | Oh Mom! | PASS |
| B1 | Detail metadata | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): Misc info (year/runtime) | 2026 1h 30m 8.5 \| | 2026 1h 30m 8.5 \| | PASS |
| B1 | Detail metadata | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): Official rating |  |  | PASS |
| B1 | Detail metadata | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): Genres | Comedy, Drama | Comedy, Drama | PASS |
| B1 | Detail metadata | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): Overview | How much is contained in these two words—irritation, tenderness, laughter, love. | How much is contained in these two words—irritation, tenderness, laughter, love. | PASS |
| B1 | Detail metadata | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): Studios |  |  | PASS |
| B1 | Detail metadata | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): Tags | didactic | didactic | PASS |
| B2 | Artwork | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): primary image path/tag | /Items/7abf2626a4b4b9ee371ab6ea7667c09a/Images/Primary | /Items/7abf2626a4b4b9ee371ab6ea7667c09a/Images/Primary | PASS |
| B3 | Cast/crew | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): cast id sequence | 12 | 12 | PASS |
| B1 | Detail metadata | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): Title | Interstate 60 | Interstate 60 | PASS |
| B1 | Detail metadata | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): Misc info (year/runtime) | 2002 1h 52m R 7.4 \| | 2002 1h 52m R 7.4 \| | PASS |
| B1 | Detail metadata | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): Official rating | R | R | PASS |
| B1 | Detail metadata | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): Genres | Adventure, Fantasy, Drama | Adventure, Fantasy, Drama | PASS |
| B1 | Detail metadata | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): Overview | An aspiring painter meets various characters and learns valuable lessons while t | An aspiring painter meets various characters and learns valuable lessons while t | PASS |
| B1 | Detail metadata | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): Studios | Fireworks Pictures, Redeemable Features | Fireworks Pictures, Redeemable Features | PASS |
| B1 | Detail metadata | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): Tags | motel, highway, convertible, surrealism, road trip, dream girl, judgment, lawyer | motel, highway, convertible, surrealism, road trip, dream girl, judgment, lawyer | PASS |
| B2 | Artwork | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): primary image path/tag | /Items/8edf7076f8f209eee672d49ba2514bca/Images/Primary | /Items/8edf7076f8f209eee672d49ba2514bca/Images/Primary | PASS |
| B3 | Cast/crew | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): cast id sequence | 26 | 26 | PASS |
| B1 | Detail metadata | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): Title | The Wonderful Story of Henry Sugar | The Wonderful Story of Henry Sugar | PASS |
| B1 | Detail metadata | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): Misc info (year/runtime) | 2023 41m PG 7.3 95 \| | 2023 41m PG 7.3 95 \| | PASS |
| B1 | Detail metadata | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): Official rating | PG | PG | PASS |
| B1 | Detail metadata | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): Genres | Fantasy, Adventure, Drama | Fantasy, Adventure, Drama | PASS |
| B1 | Detail metadata | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): Overview | A rich man learns about a guru who can see without using his eyes. He sets out t | A rich man learns about a guru who can see without using his eyes. He sets out t | PASS |
| B1 | Detail metadata | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): Studios | American Empirical Pictures, Indian Paintbrush | American Empirical Pictures, Indian Paintbrush | PASS |
| B1 | Detail metadata | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): Tags | list-one, london, england, card game, casino, based on novel or book, gambling,  | list-one, london, england, card game, casino, based on novel or book, gambling,  | PASS |
| B2 | Artwork | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): primary image path/tag | /Items/9f87e86fdb9995e801fd25c675b66cf4/Images/Primary | /Items/9f87e86fdb9995e801fd25c675b66cf4/Images/Primary | PASS |
| B3 | Cast/crew | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): cast id sequence | 31 | 31 | PASS |
| B1 | Detail metadata | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): Title | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM | PASS |
| B1 | Detail metadata | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): Misc info (year/runtime) | 2022 1h 19m 6.6 \| | 2022 1h 19m 6.6 \| | PASS |
| B1 | Detail metadata | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): Official rating |  |  | PASS |
| B1 | Detail metadata | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): Genres |  |  | PASS |
| B1 | Detail metadata | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): Overview | In the aftermath of George Floyd’s death, the media concocted a narrative that j | In the aftermath of George Floyd’s death, the media concocted a narrative that j | PASS |
| B1 | Detail metadata | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): Studios |  |  | PASS |
| B1 | Detail metadata | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): Tags |  |  | PASS |
| B2 | Artwork | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): primary image path/tag | /Items/b00893883b6bbd226e9bd99469ec3128/Images/Primary | /Items/b00893883b6bbd226e9bd99469ec3128/Images/Primary | PASS |
| B3 | Cast/crew | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): cast id sequence | 30 | 30 | PASS |
| B4 | Media info | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): media info badges (Ends at excluded) | 2021 / 1h 11m | 2021 / 1h 11m | PASS |
| B4 | Media info | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): "Ends at" equals read time + runtime (±1 min) | Ends at 9:58 AM @22:48:08Z | Ends at 9:58 AM @22:48:09Z | PASS |
| B4 | Media info | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): audio streams offered (detail select) | 2:Dolby Digital - Stereo | 2:Dolby Digital - Stereo | PASS |
| B4 | Media info | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): subtitle streams offered (detail select) | -1:Off / 0:Undefined - SUBRIP - External | -1:Off / 0:Undefined - SUBRIP - External | PASS |
| B4 | Media info | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): media info badges (Ends at excluded) | 2024 / 1h 35m / 7.1 | 2024 / 1h 35m / 7.1 | PASS |
| B4 | Media info | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): "Ends at" equals read time + runtime (±1 min) | Ends at 10:23 AM @22:48:10Z | Ends at 10:23 AM @22:48:11Z | PASS |
| B4 | Media info | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): audio streams offered (detail select) | 1:Main - Stereo - Default | 1:Main - Stereo - Default | PASS |
| B4 | Media info | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): subtitle streams offered (detail select) | -1:Off | -1:Off | PASS |
| B4 | Media info | Highlander (0b112cfd083cae1722f28359797f5b65): media info badges (Ends at excluded) | 1986 / 1h 57m / R / 6.9 / 70 | 1986 / 1h 57m / R / 6.9 / 70 | PASS |
| B4 | Media info | Highlander (0b112cfd083cae1722f28359797f5b65): "Ends at" equals read time + runtime (±1 min) | Ends at 10:44 AM @22:48:13Z | Ends at 10:44 AM @22:48:14Z | PASS |
| B4 | Media info | Highlander (0b112cfd083cae1722f28359797f5b65): audio streams offered (detail select) | 1:Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТК "ICTV", "1+1" - Dolby Digital - Stereo - Default / 2:Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТРК "Україна", "NLO.TV" - Dolby Digital - Stereo | 1:Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТК "ICTV", "1+1" - Dolby Digital - Stereo - Default / 2:Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТРК "Україна", "NLO.TV" - Dolby Digital - Stereo | PASS |
| B4 | Media info | Highlander (0b112cfd083cae1722f28359797f5b65): subtitle streams offered (detail select) | -1:Off / 5:Ukrainian \| Forced - Default - SUBRIP / 6:Ukrainian \| Full \| Netflix \| Переклад: Анастасія Малицька - SUBRIP / 7:English \| Full - SUBRIP / 8:English \| SDH - SUBRIP | -1:Off / 5:Ukrainian \| Forced - Default - SUBRIP / 6:Ukrainian \| Full \| Netflix \| Переклад: Анастасія Малицька - SUBRIP / 7:English \| Full - SUBRIP / 8:English \| SDH - SUBRIP | PASS |
| B4 | Media info | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): media info badges (Ends at excluded) | 1991 / 1h 50m / R / 4.7 | 1991 / 1h 50m / R / 4.7 | PASS |
| B4 | Media info | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): "Ends at" equals read time + runtime (±1 min) | Ends at 10:37 AM @22:48:15Z | Ends at 10:37 AM @22:48:16Z | PASS |
| B4 | Media info | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): audio streams offered (detail select) | 1:Дублированный (РТР) - Russian - Dolby Digital - Stereo - Default / 2:Дублированный (Хлопушка) - Russian - Dolby Digital - Stereo / 3:Многоголосый (DVD Group) - Russian - Dolby Digital - 5.1 / 4:Мног | 1:Дублированный (РТР) - Russian - Dolby Digital - Stereo - Default / 2:Дублированный (Хлопушка) - Russian - Dolby Digital - Stereo / 3:Многоголосый (DVD Group) - Russian - Dolby Digital - 5.1 / 4:Мног | PASS |
| B4 | Media info | Highlander II: The Quickening (1a0b81d432dbe0cc9efb467117cf50ac): subtitle streams offered (detail select) | -1:Off / 11:Russian - SUBRIP / 12:English - SUBRIP | -1:Off / 11:Russian - SUBRIP / 12:English - SUBRIP | PASS |
| B4 | Media info | Mercy (1c3a1ac050339e228c8b6033556ff638): media info badges (Ends at excluded) | 2026 / 1h 40m / PG-13 / 7.1 | 2026 / 1h 40m / PG-13 / 7.1 | PASS |
| B4 | Media info | Mercy (1c3a1ac050339e228c8b6033556ff638): "Ends at" equals read time + runtime (±1 min) | Ends at 10:27 AM @22:48:18Z | Ends at 10:27 AM @22:48:19Z | PASS |
| B4 | Media info | Mercy (1c3a1ac050339e228c8b6033556ff638): audio streams offered (detail select) | 5:DUB  Red Head Sound - Russian - Dolby Digital - 5.1 - Default / 6:DUB WinMedia - Russian - Dolby Digital - 5.1 / 7:English - Dolby Digital - 5.1 | 5:DUB  Red Head Sound - Russian - Dolby Digital - 5.1 - Default / 6:DUB WinMedia - Russian - Dolby Digital - 5.1 / 7:English - Dolby Digital - 5.1 | PASS |
| B4 | Media info | Mercy (1c3a1ac050339e228c8b6033556ff638): subtitle streams offered (detail select) | -1:Off / 0:stream-4 - Russian - Default - SUBRIP - External / 1:stream-5 - Russian - SUBRIP - External / 2:stream-6 - English - SUBRIP - External / 3:stream-7 - English - SUBRIP - External | -1:Off / 0:stream-4 - Russian - Default - SUBRIP - External / 1:stream-5 - Russian - SUBRIP - External / 2:stream-6 - English - SUBRIP - External / 3:stream-7 - English - SUBRIP - External | PASS |
| B4 | Media info | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): media info badges (Ends at excluded) | 2021 / 54m / 6.1 | 2021 / 54m / 6.1 | PASS |
| B4 | Media info | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): "Ends at" equals read time + runtime (±1 min) | Ends at 9:41 AM @22:48:20Z | Ends at 9:41 AM @22:48:22Z | PASS |
| B4 | Media info | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): audio streams offered (detail select) | 1:English - Dolby Digital+ - 5.1 - Default | 1:English - Dolby Digital+ - 5.1 - Default | PASS |
| B4 | Media info | The Minimalists: Less Is Now (28f5b20511edaa6c2129d8b4c98eeaee): subtitle streams offered (detail select) | -1:Off / 2:SDH - English - SUBRIP / 3:Arabic - SUBRIP / 4:Czech - SUBRIP / 5:Danish - SUBRIP / 6:German - SUBRIP / 7:Greek - SUBRIP / 8:Latin American - Spanish - SUBRIP / 9:European - Spanish - SUBRI | -1:Off / 2:SDH - English - SUBRIP / 3:Arabic - SUBRIP / 4:Czech - SUBRIP / 5:Danish - SUBRIP / 6:German - SUBRIP / 7:Greek - SUBRIP / 8:Latin American - Spanish - SUBRIP / 9:European - Spanish - SUBRI | PASS |
| B4 | Media info | After Porn Ends (3a3aeead9e4e7985a607380369528e40): media info badges (Ends at excluded) | 2012 / 1h 33m / R / 5.6 | 2012 / 1h 33m / R / 5.6 | PASS |
| B4 | Media info | After Porn Ends (3a3aeead9e4e7985a607380369528e40): "Ends at" equals read time + runtime (±1 min) | Ends at 10:21 AM @22:48:23Z | Ends at 10:21 AM @22:48:24Z | PASS |
| B4 | Media info | After Porn Ends (3a3aeead9e4e7985a607380369528e40): audio streams offered (detail select) | 1:Russian - Dolby Digital - 5.1 - Default / 2:English - Dolby Digital - 5.1 | 1:Russian - Dolby Digital - 5.1 - Default / 2:English - Dolby Digital - 5.1 | PASS |
| B4 | Media info | After Porn Ends (3a3aeead9e4e7985a607380369528e40): subtitle streams offered (detail select) | -1:Off / 3:English - SUBRIP | -1:Off / 3:English - SUBRIP | PASS |
| B4 | Media info | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): media info badges (Ends at excluded) | 2024 / 1h 40m / R / 5.7 / 59 | 2024 / 1h 40m / R / 5.7 / 59 | PASS |
| B4 | Media info | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): "Ends at" equals read time + runtime (±1 min) | Ends at 10:27 AM @22:48:26Z | Ends at 10:27 AM @22:48:27Z | PASS |
| B4 | Media info | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): audio streams offered (detail select) | 1:English - Dolby Digital+ - 5.1 - Default - Original | 1:English - Dolby Digital+ - 5.1 - Default - Original | PASS |
| B4 | Media info | Nightbitch (597ef4ff35d608fb98b4ad8fc60a7253): subtitle streams offered (detail select) | -1:Off / 2:English - SUBRIP / 3:English [SDH] - Hearing Impaired - SUBRIP | -1:Off / 2:English - SUBRIP / 3:English [SDH] - Hearing Impaired - SUBRIP | PASS |
| B4 | Media info | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): media info badges (Ends at excluded) | 2026 / 1h 30m / 8.5 | 2026 / 1h 30m / 8.5 | PASS |
| B4 | Media info | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): "Ends at" equals read time + runtime (±1 min) | Ends at 10:18 AM @22:48:28Z | Ends at 10:18 AM @22:48:30Z | PASS |
| B4 | Media info | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): audio streams offered (detail select) | 1:Оригінал E-AC3 5.1 640 Кбіт/с - Ukrainian - Dolby Digital+ - Default - Original | 1:Оригінал E-AC3 5.1 640 Кбіт/с - Ukrainian - Dolby Digital+ - Default - Original | PASS |
| B4 | Media info | Oh Mom! (7abf2626a4b4b9ee371ab6ea7667c09a): subtitle streams offered (detail select) | -1:Off / 2:Повні *.srt - Ukrainian - SUBRIP / 3:SDH *.srt - Ukrainian - Hearing Impaired - SUBRIP / 4:Повні *.srt - English - SUBRIP | -1:Off / 2:Повні *.srt - Ukrainian - SUBRIP / 3:SDH *.srt - Ukrainian - Hearing Impaired - SUBRIP / 4:Повні *.srt - English - SUBRIP | PASS |
| B4 | Media info | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): media info badges (Ends at excluded) | 2002 / 1h 52m / R / 7.4 | 2002 / 1h 52m / R / 7.4 | PASS |
| B4 | Media info | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): "Ends at" equals read time + runtime (±1 min) | Ends at 9:11 AM @22:48:31Z | Ends at 9:11 AM @22:48:32Z | PASS |
| B4 | Media info | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): audio streams offered (detail select) | 3:Russian - Dolby Digital - 5.1 - Default / 4:English - Dolby Digital - Stereo | 3:Russian - Dolby Digital - 5.1 - Default / 4:English - Dolby Digital - Stereo | PASS |
| B4 | Media info | Interstate 60 (8edf7076f8f209eee672d49ba2514bca): subtitle streams offered (detail select) | -1:Off / 0:0 - Russian - SUBRIP - External / 1:Russian - SUBRIP - External | -1:Off / 0:0 - Russian - SUBRIP - External / 1:Russian - SUBRIP - External | PASS |
| B4 | Media info | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): media info badges (Ends at excluded) | 2023 / 41m / PG / 7.3 / 95 | 2023 / 41m / PG / 7.3 / 95 | PASS |
| B4 | Media info | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): "Ends at" equals read time + runtime (±1 min) | Ends at 9:29 AM @22:48:33Z | Ends at 9:29 AM @22:48:35Z | PASS |
| B4 | Media info | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): audio streams offered (detail select) | 1:LostFilm - Russian - Dolby Digital - Stereo - Default / 2:Многоголосый - Russian - AAC - Stereo / 3:OZZ - Russian - AAC - Stereo / 4:Токсин - Russian - AAC - Stereo / 5:English - Dolby Digital+ - 5. | 1:LostFilm - Russian - Dolby Digital - Stereo - Default / 2:Многоголосый - Russian - AAC - Stereo / 3:OZZ - Russian - AAC - Stereo / 4:Токсин - Russian - AAC - Stereo / 5:English - Dolby Digital+ - 5. | PASS |
| B4 | Media info | The Wonderful Story of Henry Sugar (9f87e86fdb9995e801fd25c675b66cf4): subtitle streams offered (detail select) | -1:Off / 6:Russian (Forced) - Default - SUBRIP / 7:Russian - SUBRIP / 8:English - SUBRIP | -1:Off / 6:Russian (Forced) - Default - SUBRIP / 7:Russian - SUBRIP / 8:English - SUBRIP | PASS |
| B4 | Media info | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): media info badges (Ends at excluded) | 2022 / 1h 19m / 6.6 | 2022 / 1h 19m / 6.6 | PASS |
| B4 | Media info | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): "Ends at" equals read time + runtime (±1 min) | Ends at 10:07 AM @22:48:36Z | Ends at 10:07 AM @22:48:37Z | PASS |
| B4 | Media info | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): audio streams offered (detail select) | 1:AAC - Stereo - Default | 1:AAC - Stereo - Default | PASS |
| B4 | Media info | The Greatest Lie Ever Sold: George Floyd and the Rise of BLM (b00893883b6bbd226e9bd99469ec3128): subtitle streams offered (detail select) | -1:Off | -1:Off | PASS |
| B5 | Episodes/Seasons | The Wheel of Time: season selector | 0 | 0 | PASS |
| B5 | Episodes/Seasons | The Wheel of Time: default season episode list | 4 | 4 | PASS |
| B6 | Home rows | Continue Watching + Next Up (mod merges them into one row, UX 2026-09-04) | CW 12 + Next Up 9 | merged 24, separate Next Up 0 | PASS |
| B7 | Version selector | Night of the Living Dead (b5399065a2bf8fbbf6effe875180b811): version list | [{"value":"b5399065a2bf8fbbf6effe875180b811","label":"1080p BluRay"},{"value":"2558c83d688659351b80a17491b5f160","label":"720p BluRay"}] | [{"value":"b5399065a2bf8fbbf6effe875180b811","label":"1080p BluRay"},{"value":"2558c83d688659351b80a17491b5f160","label":"720p BluRay"}] | PASS |
| C0 | Playback | Fixtures chosen: C-4KHDR, C-1080, C-MULTIAUDIO, C-EMBEDSUB, C-EXTSUB, C-AVI, C-TVNEXT, C-TWOVER | n/a | n/a | RECORDED |
| C-NAMED-Highlander-a | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): start (one Sessions/Playing, same item/source, playing) | started:true in 5.8s, 1 Playing | started:true in 2.7s, 1 Playing | PASS |
| C-NAMED-Highlander-b | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): play method | Transcode; transcode hevc/aac video-direct:true audio-direct:false reasons:AudioCodecNotSupported | Transcode; transcode hevc/aac video-direct:true audio-direct:false reasons:AudioCodecNotSupported | PASS |
| C-NAMED-Highlander-c | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): transcode reasons | ["AudioCodecNotSupported"] | ["AudioCodecNotSupported"] | PASS |
| C-NAMED-Highlander-d | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): stream shape | hls | hls | PASS |
| C-NAMED-Highlander-e | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): seek (ArrowRight x10, paced) | {"skipSeconds":5,"expected":50,"skipped":50.1,"jumps":[5.1,5,5,5,5,5,5,5,5,5],"before":1.2,"after":52.6,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.5} | {"skipSeconds":5,"expected":50,"skipped":49.9,"jumps":[4.9,4.9,5,5.1,4.9,5.1,5,4.9,5.1,5],"before":1.2,"after":52.4,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.3 | PASS |
| C-NAMED-Highlander-f | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): audio switch (to a genuinely different track, by data-id) | {"fromIndex":1,"targetIndex":2,"options":[{"id":"1","text":"Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТК \"ICTV\", \"1+1\" -"},{"id":"2","text":"Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТРК | {"fromIndex":1,"targetIndex":2,"options":[{"id":"1","text":"Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТК \"ICTV\", \"1+1\" -"},{"id":"2","text":"Ukrainian \| AC-3 \| 2.0 \| 192 kbps \| MVO \| ТРК | PASS |
| C-NAMED-Highlander-g | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): subtitle switch (by data-id) + render | {"fromIndex":5,"preOff":null,"targetIndex":6,"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"5","text":"Ukrainian \| Forced - Default - SUBRIP" | {"fromIndex":5,"preOff":null,"targetIndex":6,"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"5","text":"Ukrainian \| Forced - Default - SUBRIP" | PASS |
| C-NAMED-Highlander-h | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): subtitle off (data-id -1) | {"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"5","text":"Ukrainian \| Forced - Default - SUBRIP"},{"id":"6","text":"Ukrainian \| Full \| Net | {"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"5","text":"Ukrainian \| Forced - Default - SUBRIP"},{"id":"6","text":"Ukrainian \| Full \| Net | PASS |
| C-NAMED-Highlander-i | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): stop and resume (stopped at 20%) | {"stoppedAt":1402.2,"stored":1402.2,"resumeOffered":true,"resumedAt":1402.2,"resumedPlaying":true} | {"stoppedAt":1401.7,"stored":1401.7,"resumeOffered":true,"resumedAt":1401.7,"resumedPlaying":true} | PASS |
| C-NAMED-Highlander-j | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): single reporting (no duplicate Playing/Stopped) | playing:1 stopped:1 | playing:1 stopped:1 | PASS |
| C-NAMED-DavidBeckhamInfamous-a | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): start (one Sessions/Playing, same item/source, playing) | started:true in 9.6s, 1 Playing | started:true in 2.3s, 1 Playing | PASS |
| C-NAMED-DavidBeckhamInfamous-b | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): play method | Transcode; transcode h264/aac video-direct:false audio-direct:false reasons:ContainerNotSupported+VideoCodecNotSupported+AudioCodecNotSupported | Transcode; transcode h264/aac video-direct:false audio-direct:false reasons:ContainerNotSupported+VideoCodecNotSupported+AudioCodecNotSupported | PASS |
| C-NAMED-DavidBeckhamInfamous-c | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): transcode reasons | ["ContainerNotSupported","VideoCodecNotSupported","AudioCodecNotSupported"] | ["ContainerNotSupported","VideoCodecNotSupported","AudioCodecNotSupported"] | PASS |
| C-NAMED-DavidBeckhamInfamous-d | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): stream shape | hls | hls | PASS |
| C-NAMED-DavidBeckhamInfamous-e | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): seek (ArrowRight x10, paced) | {"skipSeconds":5,"expected":50,"skipped":49.8,"jumps":[4.7,5.1,5,5,5,5.1,4.9,4.9,5.1,5],"before":1.2,"after":52.3,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.2} | {"skipSeconds":5,"expected":50,"skipped":49.9,"jumps":[5,5,5,5,5,5,5,4.9,5.1,4.9],"before":1.1,"after":52.3,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.3} | PASS |
| C-NAMED-DavidBeckhamInfamous-g | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): subtitle switch (by data-id) + render | {"fromIndex":-1,"preOff":{"from":0,"serverIndex":-1},"targetIndex":0,"options":[{"id":"-1","text":"Off"},{"id":"0","text":"Undefined - SUBRIP - External"}],"serverIndex":0,"trackLoaded":true,"actually | {"fromIndex":-1,"preOff":{"from":0,"serverIndex":-1},"targetIndex":0,"options":[{"id":"-1","text":"Off"},{"id":"0","text":"Undefined - SUBRIP - External"}],"serverIndex":0,"trackLoaded":true,"actually | PASS |
| C-NAMED-DavidBeckhamInfamous-h | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): subtitle off (data-id -1) | {"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"0","text":"Undefined - SUBRIP - External"}],"serverIndexOff":-1,"isOff":true,"overlayEmpty":tr | {"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"0","text":"Undefined - SUBRIP - External"}],"serverIndexOff":-1,"isOff":true,"overlayEmpty":tr | PASS |
| C-NAMED-DavidBeckhamInfamous-i | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): stop and resume (stopped at 20%) | {"stoppedAt":852.2,"stored":852.2,"resumeOffered":true,"resumedAt":852.2,"resumedPlaying":true} | {"stoppedAt":852.7,"stored":852.7,"resumeOffered":true,"resumedAt":852.7,"resumedPlaying":true} | PASS |
| C-NAMED-DavidBeckhamInfamous-j | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): single reporting (no duplicate Playing/Stopped) | playing:1 stopped:1 | playing:1 stopped:1 | PASS |
| C-NAMED-Mercy-a | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): start (one Sessions/Playing, same item/source, playing) | started:true in 9.7s, 1 Playing | started:true in 3.5s, 1 Playing | PASS |
| C-NAMED-Mercy-b | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): play method | Transcode; transcode hevc/aac video-direct:true audio-direct:false reasons:AudioCodecNotSupported | Transcode; transcode hevc/aac video-direct:true audio-direct:false reasons:AudioCodecNotSupported | PASS |
| C-NAMED-Mercy-c | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): transcode reasons | ["AudioCodecNotSupported"] | ["AudioCodecNotSupported"] | PASS |
| C-NAMED-Mercy-d | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): stream shape | hls | hls | PASS |
| C-NAMED-Mercy-e | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): seek (ArrowRight x10, paced) | {"skipSeconds":5,"expected":50,"skipped":49.9,"jumps":[5,5,4.9,5,5,5,5,5,5,5],"before":1.1,"after":52.3,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.3} | {"skipSeconds":5,"expected":50,"skipped":49.9,"jumps":[5,4.9,4.9,5.1,4.9,5.1,5,5,5,5],"before":1.1,"after":52.3,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.2} | PASS |
| C-NAMED-Mercy-f | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): audio switch (to a genuinely different track, by data-id) | {"fromIndex":7,"targetIndex":5,"options":[{"id":"5","text":"DUB  Red Head Sound - Russian - Dolby Digital - 5.1 - Defaul"},{"id":"6","text":"DUB WinMedia - Russian - Dolby Digital - 5.1"},{"id":"7","t | {"fromIndex":7,"targetIndex":5,"options":[{"id":"5","text":"DUB  Red Head Sound - Russian - Dolby Digital - 5.1 - Defaul"},{"id":"6","text":"DUB WinMedia - Russian - Dolby Digital - 5.1"},{"id":"7","t | PASS |
| C-NAMED-Mercy-g | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): subtitle switch (by data-id) + render | {"fromIndex":1,"preOff":null,"targetIndex":0,"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"0","text":"stream-4 - Russian - Default - SUBRIP - | {"fromIndex":1,"preOff":null,"targetIndex":0,"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"0","text":"stream-4 - Russian - Default - SUBRIP - | PASS |
| C-NAMED-Mercy-h | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): subtitle off (data-id -1) | {"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"0","text":"stream-4 - Russian - Default - SUBRIP - External"},{"id":"1","text":"stream-5 - Rus | {"options":[{"id":"secondarysubtitle","text":"Secondary Subtitles – Off"},{"id":"-1","text":"Off"},{"id":"0","text":"stream-4 - Russian - Default - SUBRIP - External"},{"id":"1","text":"stream-5 - Rus | PASS |
| C-NAMED-Mercy-i | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): stop and resume (stopped at 20%) | {"stoppedAt":1197.4,"stored":1197.4,"resumeOffered":true,"resumedAt":1197.4,"resumedPlaying":true} | {"stoppedAt":1197.1,"stored":1197.1,"resumeOffered":true,"resumedAt":1197.1,"resumedPlaying":true} | PASS |
| C-NAMED-Mercy-j | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): single reporting (no duplicate Playing/Stopped) | playing:1 stopped:1 | playing:1 stopped:1 | PASS |
| C-NAMED-LessonsofTolerance-a | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): start (one Sessions/Playing, same item/source, playing) | started:true in 1.6s, 1 Playing | started:true in 1.6s, 1 Playing | PASS |
| C-NAMED-LessonsofTolerance-b | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): play method | DirectPlay; transcode none | DirectPlay; transcode none | PASS |
| C-NAMED-LessonsofTolerance-c | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): transcode reasons | [] | [] | PASS |
| C-NAMED-LessonsofTolerance-d | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): stream shape | static | static | PASS |
| C-NAMED-LessonsofTolerance-e | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): seek (ArrowRight x10, paced) | {"skipSeconds":5,"expected":50,"skipped":49.9,"jumps":[4.9,5,5,5,5,5,5,5,4.9,5.1],"before":1.1,"after":52.4,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.3} | {"skipSeconds":5,"expected":50,"skipped":50,"jumps":[4.9,5.1,5,5,4.9,5.1,4.9,5.1,4.9,5.1],"before":1.1,"after":52.4,"settledAll":true,"playingAfter":true,"reported":true,"reportedPositionSeconds":41.3 | PASS |
| C-NAMED-LessonsofTolerance-i | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): stop and resume (stopped at 20%) | {"stoppedAt":1148.4,"stored":1148.4,"resumeOffered":true,"resumedAt":1148.4,"resumedPlaying":true} | {"stoppedAt":1148.7,"stored":1148.7,"resumeOffered":true,"resumedAt":1148.7,"resumedPlaying":true} | PASS |
| C-NAMED-LessonsofTolerance-j | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): single reporting (no duplicate Playing/Stopped) | playing:1 stopped:1 | playing:1 stopped:1 | PASS |
| C-4KHDR | Playback | Mercy (1c3a1ac050339e228c8b6033556ff638): covered by C-NAMED-Mercy (= C-4KHDR) | see named row | see named row | RECORDED |
| C-1080 | Playback | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): covered by C-NAMED-LessonsofTolerance (= C-1080) | see named row | see named row | RECORDED |
| C-MULTIAUDIO | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): covered by C-NAMED-Highlander (= C-MULTIAUDIO, C-EMBEDSUB) | see named row | see named row | RECORDED |
| C-EMBEDSUB | Playback | Highlander (0b112cfd083cae1722f28359797f5b65): covered by C-NAMED-Highlander (= C-MULTIAUDIO, C-EMBEDSUB) | see named row | see named row | RECORDED |
| C-EXTSUB | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): covered by C-NAMED-DavidBeckhamInfamous (= C-EXTSUB, C-AVI) | see named row | see named row | RECORDED |
| C | Playback | C-M2TS | n/a | n/a | SKIPPED |
| C-AVI | Playback | David Beckham Infamous (0040709081e66d6e20f562643b81a00f): covered by C-NAMED-DavidBeckhamInfamous (= C-EXTSUB, C-AVI) | see named row | see named row | RECORDED |
| C-TVNEXT | Playback | The Wheel of Time - Leavetaking: end-of-episode behaviour | {"hash":"#/video","ended":false,"nowPlaying":"same episode"} | {"hash":"#/video","ended":false,"nowPlaying":"same episode"} | PASS |
| C-TWOVER | Playback | Night of the Living Dead (b5399065a2bf8fbbf6effe875180b811): version selection honoured | {"b5399065a2bf8fbbf6effe875180b811":"b5399065a2bf8fbbf6effe875180b811","2558c83d688659351b80a17491b5f160":"2558c83d688659351b80a17491b5f160"} | {"b5399065a2bf8fbbf6effe875180b811":"b5399065a2bf8fbbf6effe875180b811","2558c83d688659351b80a17491b5f160":"2558c83d688659351b80a17491b5f160"} | PASS |
| D-1 | User data | movie David Beckham Infamous: mark watched (S to M) | server:true | observer(M):true | PASS |
| D-2 | User data | movie David Beckham Infamous: mark unwatched (S to M) | server:true | observer(M):true | PASS |
| D-3 | User data | movie David Beckham Infamous: favourite (S to M) | server:true | observer(M):true | PASS |
| D-4 | User data | movie David Beckham Infamous: unfavourite (S to M) | server:true | observer(M):true | PASS |
| D-1 | User data | movie David Beckham Infamous: mark watched (M to S) | server:true | observer(S):true | PASS |
| D-2 | User data | movie David Beckham Infamous: mark unwatched (M to S) | server:true | observer(S):true | PASS |
| D-3 | User data | movie David Beckham Infamous: favourite (M to S) | server:true | observer(S):true | PASS |
| D-4 | User data | movie David Beckham Infamous: unfavourite (M to S) | server:true | observer(S):true | PASS |
| E-1 | Mod-only | File-state marks present (recorded) | 0 | 0 | RECORDED |
| E-3 | Mod-only | Queue reachable at #/catalog/queue on mod | n/a (mod-only) | true | PASS |
| E-4 | Mod-only | Search "20": Add-from-TMDB zone present + upstream results match | 13 ids | discovery:true, 13 ids | PASS |
| E-6 | Mod-only | Degrades cleanly with plugin transport blocked (UX §14) | n/a | grid:true detail:true | PASS |
| E-7 | Mod-only | No id leak outside /JellyfinMod/** on either tab | 0 | 0 | PASS |
| E-5 | Mod-only | Stock Movies total re-checked alone matches paired run | 55 | 55 | PASS |
| F | TV layout | S at 1920x1080: renders/legacy-header/navigable | true/true/true |  | EXPECTED-FALLBACK |
| F | TV layout | M at 1920x1080: renders/legacy-header/navigable |  | true/true/true | EXPECTED-FALLBACK |
| F | TV layout | S at 1280x720: renders/legacy-header/navigable | true/true/true |  | EXPECTED-FALLBACK |
| F | TV layout | M at 1280x720: renders/legacy-header/navigable |  | true/true/true | EXPECTED-FALLBACK |
| T-inv | TV layout | Movies id set at 1920x1080 (layout-tv true/true), lazy-load/paged | 55 ids | 55 ids (api 55) | PASS |
| T-inv | TV layout | TV id set at 1920x1080 (layout-tv true/true), paged/paged | 105 ids | 105 ids (api 105) | PASS |
| T-play | TV layout | Lessons of Tolerance (09be82fc66ac0aa8a3a9df0450fa7406): keys-only play, seek, Back, Resume at 1920x1080 | {"playFocused":true,"started":true,"seek":{"before":1.6,"after":22.1,"delta":20.5,"playingAfter":true},"stoppedByBack":true,"stoppedAt":1721.4,"backLandedOn":"#/details","resumeFocused":true,"resumedA | {"playFocused":true,"started":true,"seek":{"before":1.6,"after":22.1,"delta":20.5,"playingAfter":true},"stoppedByBack":true,"stoppedAt":1721.6,"backLandedOn":"#/details","resumeFocused":true,"resumedA | PASS |
| T-inv | TV layout | Movies id set at 1280x720 (layout-tv true/true), lazy-load/paged | 55 ids | 55 ids (api 55) | PASS |
| T-inv | TV layout | TV id set at 1280x720 (layout-tv true/true), paged/paged | 105 ids | 105 ids (api 105) | PASS |
| G | Reachability | Mod #/music renders without an uncaught exception | n/a (mod-only smoke) | true | PASS |
| G | Reachability | Mod #/livetv renders without an uncaught exception | n/a (mod-only smoke) | true | PASS |
| G | Reachability | Mod #/books renders without an uncaught exception | n/a (mod-only smoke) | true | PASS |
| G | Reachability | Mod #/playlists renders without an uncaught exception | n/a (mod-only smoke) | true | PASS |
| G | Reachability | Mod #/boxsets renders without an uncaught exception | n/a (mod-only smoke) | true | PASS |
| G | Reachability | Mod #/dashboard renders without an uncaught exception | n/a (mod-only smoke) | true | PASS |
| G | Reachability | Mod #/mypreferencesmenu renders without an uncaught exception | n/a (mod-only smoke) | true | PASS |
| cleanup | Cleanup | UserData restored and verified for 8 item(s) | restored | restored | PASS |
| cleanup | Cleanup | No JellyfinMod-prefixed title in any library | none | none | PASS |
| cleanup | Cleanup | No JellyfinMod-prefixed title in GET /JellyfinMod/Entries | none | none | PASS |
| cleanup | Cleanup | JellyfinMod/Entries set unchanged | 159 entries | 159 entries | PASS |
| takeover | Cleanup | /web takeover untouched (read only in this shape) | {"TakeoverEnabled":true,"BundleId":"3b7675071649","state":"patched"} | {"state":"patched","bundleId":"3b7675071649"} | PASS |

## Failures
None.
## Skipped
- **A6** First boxset children: no BoxSet exists in this library
- **C-M2TS** Fixture selection: no item in the library matches this predicate
- **C** C-M2TS: no fixture selected for C-M2TS

## Known gaps observed (not failures)
See PARITY.md §8.
- A3 sampled 40 of 105 series (§9.3 escape hatch: library exceeds ~40 series) rather than exhaustive coverage.
- Area F (TV layout) recorded per PARITY.md §8.3/Area F: ModAppLayout deliberately falls back to LegacyAppLayout on TV. Not asserted as pass/fail.

## Cleanup
8 item(s) touched; cleanupFailed=false. See userdata-before.json / userdata-after.json / restore-actions.json.

## Verdict summary
```
{
  "PASS": 246,
  "SKIPPED": 2,
  "RECORDED": 10,
  "EXPECTED-FALLBACK": 4
}
```
