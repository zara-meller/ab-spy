# Chrome Web Store listing: A/B Spy

Copy each field into the matching box in the Chrome Web Store developer dashboard.

## Store listing tab

**Name** (comes from manifest.json)
A/B Spy

**Summary** (comes from manifest.json, max 132 characters)
See the A/B tests a website is running right now: every version of the headline, button and page, including the ones you aren't shown.

**Description**

```
See what any website is testing right now.

Big brands test everything: headlines, prices, buttons, hero images, whole landing pages. You normally see one version and never find out about the others. A/B Spy shows you all of them.

Open any website and the icon tells you how many A/B tests are running. Click it for a plain-English answer, like "ASOS is testing 3 things right now", and then:

• Every live test, in plain words, with the markets it runs in
• Every version of each test: the new copy, images and colours, and where split tests send visitors
• What each change does: "Hides the hero", "Changes a background colour", "Sends visitors to a new checkout"
• Which version you got, and which ones everyone else might be seeing
• Personalized content and changes shipped without a test, listed separately so you know what's a real test

One click copies the whole list as plain text, ready for a competitor teardown, a Slack message or a client deck.

Works with Optimizely, VWO, Convert, AB Tasty, Kameleoon, GrowthBook and PostHog. It also tells you when a site uses Adobe Target, Dynamic Yield, Monetate, LaunchDarkly, Statsig and other tools that choose versions on their own servers.

Made for marketers, growth teams, CRO specialists, designers and founders who want to learn from what other companies are testing.

Private by design: A/B Spy only reads test settings that websites already send to every visitor's browser. It has no server, no analytics and no account, and nothing it reads ever leaves your browser.
```

**Category**
Tools

**Language**
English

**Graphics** (all in this folder)
- Store icon: `../icons/icon128.png`
- Screenshots (1280×800): `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png`
- Small promo tile (440×280): `promo-small.png`

**Privacy policy URL** (once GitHub Pages is on, see the README steps)
https://YOUR-GITHUB-USERNAME.github.io/ab-spy/privacy.html

## Privacy tab

**Single purpose**
```
A/B Spy shows the user which A/B tests the website in the current tab is running, and lists every version of each test.
```

**Permission justifications**

storage:
```
Keeps the list of tests found in each open tab so the popup can show it. The list is kept in session storage and removed when the tab closes.
```

scripting:
```
Used only when the user opens the popup on a tab that was already open before the extension was installed, to run the same test reader that normally runs on page load.
```

Host permissions (http://*/* and https://*/*):
```
The extension's single purpose is to show the A/B tests on any website the user visits, so it needs to read the test settings that testing tools load on every page. It reads only those settings, and nothing is sent off the device.
```

**Remote code**
No, I am not using remote code.

**Data usage**
Tick none of the data types. A/B Spy collects no user data.

Then tick all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes
