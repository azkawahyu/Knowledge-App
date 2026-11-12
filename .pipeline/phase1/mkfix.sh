#!/usr/bin/env bash
# mkfix.sh — generate the T3 fixtures (PLAN §7 T3), outside the repo source tree.
set -u
FIX="$1"
FIXW="$2"
mkdir -p "$FIX"
cd "$FIX" || exit 1
W() { node "$FIXW/_mk.js" "$@"; }
cat > "$FIX/_mk.js" <<'JS'
const fs = require('fs');
const [file, text, rep, mode] = process.argv.slice(2);
if (mode === 'buf') {
  fs.writeFileSync(file, Buffer.from(text));
} else if (mode === 'big') {
  fs.writeFileSync(file, Buffer.alloc(26 * 1024 * 1024, 97));
} else {
  fs.writeFileSync(file, text.repeat(Number(rep)));
}
JS
W p1-ok3.txt   'Cobalt driftwood elderberry fathom glisten harness imperil jarring kindle lantern mosaic nectar orchard plumage quill ravenous sapphire thistle upland vellum willow xenial yarrow zenith almanac birch cavern. ' 6
W p1-ok.txt    'Zephyr quartz nymph vortex jigsaw baffle cobbler dwindled ember fickle gallant hustle ivory jostle knuckle lattice murmur nibble obtuse prattle quiver rustle sizzle tundra umbrage vivid waddle yoke zipper. ' 6
W p1-ok2.txt   'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu anvil beacon cinder. ' 6
W p1-t10.txt   'Amber bramble cascade dapple escarp fjord granite hollow inlet juniper kelp lagoon meadow niche onyx prairie quarry ripple sedan tundra umbra valley wisp yonder zealot abacus bellow crag. ' 6
W p1-t11.txt   'Ballast cinder dune ember flint gravel hollow ingot jetty kestrel ledge mortar nimbus opal pumice quarry rivet silt timber usher vapor whet yarrow zephyr anvil basalt cobalt. ' 6
W p1-t13.txt   'Dome ember fathom gully hollow isthmus jamb keel loam mesa notch outlet pinnacle quill ridge spire tor usher vale weir xenon yarrow zephyr alder briar crag delta. ' 6
W p1-t15.txt   'Establish falcon gable hammock ignite jaunt kelp lantern muster nudge opal prism quiver relabel saffron toll unify vessel wager xenon yeast zonal anodyne bluster cobble. ' 6
W p1-t18.txt   'Lantern quokka saddle thimble upland vesper willow xylem yonder zephyr anchor beacon cradle drift elm fable gander hush indigo jasper kettle lumen. ' 6
W p1-bad.exe      'MZ'        0 buf
W p1-broken.docx  'not-a-zip' 0 buf
W p1-broken2.docx 'also-not-a-zip-2' 0 buf
W 'résumé.txt'    'Résumé sample text for the non-ASCII filename check. ' 6
W p1-big.txt      ''          0 big
rm -f "$FIX/_mk.js"
ls -la "$FIX"