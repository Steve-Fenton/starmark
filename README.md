# starmark

*starmark* is a local web-based CMS for your [Astro](https://astro.build) or [Hugo](https://gohugo.io) site. It has been designed to work with [Astro Accelerator](https://astro.stevefenton.co.uk), but also supports standard Astro and Hugo projects.

With *starmark* you get:

- File browser
- Markdown editing
- Frontmatter editing
- Media library and image insertion

Browse and edit markdown content in local Astro and Hugo sites.

Starmark runs a small local web app that scans an Astro project for `.md` and `.mdx` files, lets you browse them in a file tree, and edit content in the browser.

## Running starmark

With a terminal open in your Astro site, simply run:

```bash
npx starmark
```

You'll be given a local address for *starmark*, usually: [http://localhost:5748](http://localhost:5748).

Visit the URL and go edit. All the changes will be in your changes tab ready for review and commit.

## License

[CC-BY-NC-ND-4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)

## Settings

Open the settings dialog from the top bar while a project is loaded. Settings are stored per project in `.starmark/project.ini` inside each project folder. Your recent project list is kept in a single user config file:

- **macOS:** `~/Library/Application Support/starmark/user.ini`
- **Windows:** `%APPDATA%\starmark\user.ini`
- **Linux:** `~/.config/starmark/user.ini` (or `$XDG_CONFIG_HOME/starmark/user.ini`)

If you previously ran *starmark* from a project folder, settings are migrated automatically from that folder's `.starmark/user.ini` the next time you open it.

You can commit `.starmark/project.ini` to share site type, image mode, media folder, and content date field settings with your team.

### Site type

Controls where starmark looks for markdown content.

- **Astro Accelerator** (default) — scans `src/content` and `src/pages`.
- **Astro** — scans `src/content` and `src/pages`.
- **Hugo** — scans `hugo/content`.

Changing site type rescans the project using the new content folders.

### Images

Controls how the image insert tool writes markup into your content.

- **Accelerator** (default) — inserts Astro Accelerator `:::figure` blocks with `:img{}` components.
- **Markdown** — inserts standard HTML `<figure>` elements with Markdown image syntax.

### Media library folder

The folder opened by the media library and image insert tools when browsing for images.

Default: `public/img`

You can enter a path relative to your project root, such as `public/blog/img` for Astro sites or `static` for Hugo sites.

### Content date field

The front matter field that is updated automatically when you save changes to a page's markdown content. Front matter-only edits do not update this field.

Default: `modDate`

If your site uses a different field name, enter it here — for example `updated` or `latestChange`. Leave the field blank to disable automatic updates.
