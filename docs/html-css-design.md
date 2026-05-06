# MeetiA HTML/CSS Design Notes

## Project Goal

Move the existing WordPress site to a Cloudflare Pages static site.

The site should be built with:

- HTML/CSS for layout and visual design
- Markdown for page and blog content updates
- Cloudflare Pages for hosting

The design should keep the soft, approachable feeling of the current site while becoming cleaner, lighter, and easier to read on both desktop and mobile.

## Site Identity

Primary site name:

```text
MeetiA
```

Subtitle/credential text:

```text
嗅覚反応分析士入門講座・基礎講座　認定教室
```

Do not place the owner's personal name directly below the site name.

## Visual Direction

Overall mood:

- Fresh
- Clean
- Gentle
- Trustworthy
- Botanical
- Light and readable

Color direction:

- Base: white
- Main: pale blue, blue-green
- Supporting: botanical green
- Accent: subtle pink beige
- Text: dark gray with a slight cool tone
- Purple should mainly come from the A-H bottle labels and chart accents

Avoid:

- Brown bottle imagery for the main visuals
- Bar charts
- A medical-looking design
- A mystical or overly spiritual tone
- An old WordPress blog theme feeling

## Images

Hero image:

- Use the dedicated A-H IM check bottle photo.
- Prefer the bright white-background bottle image for the homepage hero.

IM check section:

- Use the correct IM check chart image or a faithful visual based on it.
- The chart must show the four-quadrant structure, central vertical/horizontal axes, diagonal scale axes, and colored circle/square markers.
- Do not use bar charts, generic analytics graphs, pie charts, or unrelated dashboard graphics.

## Desktop Homepage Wireframe

```text
[Header]
MeetiA
嗅覚反応分析士入門講座・基礎講座　認定教室
Navigation:
嗅覚反応分析とは / IMチェック体験 / 講座案内 / ブログ / よくある質問 / プロフィール / お問い合わせ

[Hero]
Left:
香りの感じ方から、今の自分に合う整え方を見つける。
Short explanation
Buttons:
IMチェックを体験する
講座について見る

Right:
A-H dedicated bottle photo

[Three Entrances]
自分を知りたい方へ
しくみを知りたい方へ
読み物で学びたい方へ

[For First-Time Visitors]
Short explanation of olfactory response analysis and IM check
Button to about page

[IM Check Experience]
Left:
Correct IM check chart image

Right:
Overview of experience menu
Button to IM check page

[Courses]
入門講座
基礎講座
Button to courses page

[Blog]
Show about three recent articles
Button to blog list

[Contact]
External form button

[Footer]
MeetiA
嗅覚反応分析士入門講座・基礎講座　認定教室
Navigation and privacy policy
```

## Mobile Homepage Wireframe

Mobile layout should be single-column.

```text
[Header]
MeetiA
嗅覚反応分析士入門講座・基礎講座　認定教室
Menu button at top right

[Hero]
Main copy
Short explanation
Buttons
A-H bottle photo

[Three Entrances]
Stacked cards:
IMチェック体験
嗅覚反応分析とは
読み物

[For First-Time Visitors]
Short explanation
Image if needed
Button

[IM Check Experience]
Short explanation
Correct chart image, shown large enough to communicate the structure
Experience menu overview
Button

[Courses]
入門講座
基礎講座
Button

[Blog]
Recent articles
Button

[Contact]
External form button

[Footer]
Site name, credential text, privacy link
```

## Mobile Menu

Place a menu button in the top-right corner of the first screen.

Menu items:

- 嗅覚反応分析とは
- IMチェック体験
- 講座案内
- ブログ
- よくある質問
- プロフィール
- お問い合わせ

Emphasize:

- IMチェック体験
- お問い合わせ

Header behavior:

- Keep the header visually light.
- It may stay fixed or become subtly sticky if it does not interfere with reading.
- Avoid a large fixed header that reduces reading space.

## Components

Core components to design in HTML/CSS:

- Site header
- Mobile menu
- Hero section
- Primary button
- Secondary button
- Section heading
- Three-entry navigation cards
- Image/text split section
- Course cards
- Blog article cards
- Contact call-to-action
- Footer

Border radius:

- Keep cards and buttons modest, around 8px or less.

Spacing:

- Use generous whitespace.
- Keep text blocks readable and not too wide on desktop.
- Ensure no horizontal scrolling on mobile.

## Markdown Content Model

Pages and blog articles should be editable as Markdown.

Possible structure:

```text
src/content/pages/about.md
src/content/pages/im-check.md
src/content/pages/courses.md
src/content/blog/example.md
```

Example Markdown frontmatter:

```md
---
title: "IMチェックとは"
description: "8種類の香りを使って、今の心身の傾向をチャートで見える化するチェックです。"
---

本文をここに書きます。
```

## Recommended Technical Direction

Recommended static site generator:

- Astro

Reason:

- Works well with Cloudflare Pages
- HTML/CSS-oriented implementation is straightforward
- Markdown pages and blog articles are easy to manage
- Lightweight and suitable for a static replacement of WordPress

## Implementation Notes

Initial implementation priority:

1. Create Astro project structure
2. Add global CSS and design tokens
3. Build homepage layout
4. Add responsive mobile menu
5. Add image assets
6. Add Markdown content structure
7. Add fixed pages
8. Add blog listing and article template
9. Add Cloudflare Pages build settings
