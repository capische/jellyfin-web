#!/usr/bin/env python3
"""Seed only stopped local charlie's plugin DB and /test-media. No schema changes or TMDB credentials.

Run after deploying both worktrees, with charlie stopped; start it afterwards with JFMOD_TMDB=0.
The import-delay runner uses real NFO metadata, .disc placeholders, Torznab and Transmission HTTP.
Reset charlie to baseline after the run, even on failure. No library is added or removed here.
"""
import json
import pathlib
import sqlite3
import subprocess
import uuid

workspace = pathlib.Path(__file__).resolve().parents[3]
import os
env = os.environ.get("JFMOD_ENV", "charlie")
assert env.isalpha() and env != "alpha", "bad environment"
state = workspace / "envs/pool" / env
running = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", f"jellyfinmod-{env}"], capture_output=True, text=True)
assert (running.returncode == 0 and running.stdout.strip() == "false") or f"no such object: jellyfinmod-{env}" in running.stderr.lower(), f"cannot prove {env} is stopped"
db = sqlite3.connect(state / "config/data/jellyfinmod/jellyfinmod.db")
# The baseline's views are already configured with writable /test-media roots.
libraries = dict(db.execute("select MediaType, TargetLibraryId from Entries where TargetLibraryId is not null"))
assert set(libraries) == {"movie", "series"}
def ident(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "jellyfinmod-import-delay/" + name)).upper()

fixtures = []
for case, tmdb, count in [("episode", 987601, 1), ("pack", 987602, 4), ("movie", 987603, 0)]:
    title = "JellyfinMod Import Delay " + case.title()
    media = "movie" if case == "movie" else "series"
    eid = ident(case)
    metadata = dict(mediaType=media, tmdbId=tmdb, title=title, premiereDate="2025-01-01T00:00:00Z",
                    imdbId=f"tt{tmdb}", tvdbId=tmdb, adult=False, runtimeMinutes=1, genres=[], certifications=[],
                    seasons=[dict(number=1, name="Season 1", episodeCount=count)] if count else [])
    db.execute("insert into Entries (Id,MediaType,TmdbId,ImdbId,Title,Year,State,Monitored,TargetLibraryId,AddedAt,MetadataJson,RetentionPolicy) values (?,?,?,?,?,2025,0,0,?,'2025-01-01 00:00:00',?,2)",
               (eid, media, tmdb, f"tt{tmdb}", title, libraries[media], json.dumps(metadata)))
    folder = state / "test-media" / ("movies" if media == "movie" else "tv") / f"{title} (2025) [tmdbid-{tmdb}]"
    folder.mkdir(parents=True)
    tag = "movie" if media == "movie" else "tvshow"
    (folder / f"{tag}.nfo").write_text(f"<{tag}><title>{title}</title><year>2025</year><premiered>2025-01-01</premiered><uniqueid type=\"tmdb\" default=\"true\">{tmdb}</uniqueid><uniqueid type=\"tvdb\">{tmdb}</uniqueid><uniqueid type=\"imdb\">tt{tmdb}</uniqueid></{tag}>")
    episodes = []
    stubs = []
    if count:
        season = folder / "Season 01"
        season.mkdir()
        for number in range(1, count + 1):
            ep = ident(case + str(number))
            epid = tmdb * 10 + number
            db.execute("insert into Episodes (Id,EntryId,TmdbId,SeasonNumber,EpisodeNumber,Title,AirDate,RuntimeMinutes,Monitored,State) values (?,?,?,1,?,?,'2025-01-01 00:00:00',1,0,0)", (ep, eid, epid, number, f"Part {number}"))
            base = season / f"{title} S01E{number:02}"
            base.with_suffix(".nfo").write_text(f"<episodedetails><title>Part {number}</title><season>1</season><episode>{number}</episode><aired>2025-01-01</aired><uniqueid type=\"tmdb\" default=\"true\">{epid}</uniqueid></episodedetails>")
            (season / f"{title} (2025) S01E{number:02}.nfo").write_text(base.with_suffix(".nfo").read_text())
            stub = base.with_suffix(".disc")
            stub.write_text("<!-- JellyfinMod placeholder v1 -->\n<discstub><message>Not downloaded yet.</message></discstub>\n")
            stubs.append(str(stub))
            episodes.append(ep)
    else:
        stub = folder / (folder.name + ".disc")
        stub.write_text("<!-- JellyfinMod placeholder v1 -->\n<discstub><message>Not downloaded yet.</message></discstub>\n")
        stubs.append(str(stub))
    fixtures.append(dict(case=case, title=title, tmdb=tmdb, entry=eid, episodes=episodes, folder=str(folder), stubs=stubs, library=libraries[media]))
db.execute("update AcquisitionSettings set ImportPollSeconds=15,Enabled=0,SeedReleaseEnabled=0,FreeSpaceFloorBytes=0,FreeSpaceFloorPercent=0")
db.commit()
out = pathlib.Path(__file__).resolve().parents[2] / "node_modules/.cache/import-delay"
out.mkdir(parents=True, exist_ok=True)
(out / "fixtures.json").write_text(json.dumps(fixtures, indent=2))
print("Seeded three fixture titles and five episodes; no schema changes. Reset charlie after testing.")
