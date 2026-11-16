# User journeys

**Draft.** The core journeys the builder must make easy, written from the user's side. They drive the GUI design in [04-gui.md](04-gui.md) and the end-to-end tests in [17-testing-and-budgets.md](17-testing-and-budgets.md).

Two people to keep in mind:

- **Asha**, a non-technical staff member (Editor) who writes appeals and news. Mostly a laptop, sometimes only a phone, internet not always good.
- **Spencer**, an Admin and Approver, who sets things up, approves, and sometimes fixes things in a hurry from his phone.

Words in the GUI follow the [glossary](04-gui.md#glossary).

## 1. First sign-in

**Editor (Asha)**

1. Gets an invite email: "Spencer has invited you to edit the Animal Aid Unlimited website." One button.
2. Passes Cloudflare Access (an email code), then sets her name and password.
3. Sees a one-screen welcome: "Here is how pages go live: you make a draft, someone approves it, and it is live in seconds."
4. Three tiles: **Make a new page with the assistant**, **Edit an existing page**, **Take the two-minute tour**.
5. Lands on Pages. If she skips the tour, it stays available in the user menu.

**Admin (first ever sign-in)**

1. Goes straight into the setup wizard ([06-setup-wizard.md](06-setup-wizard.md)). Progress is saved after each step, so it can be finished over several sittings.
2. Ends on Pages with sample pages from the wizard's preview step, ready to edit or delete.

## 2. Create a page with the assistant

1. Pages > **New page**. The screen is a full-width conversation, with "Or pick a template" as a quiet link.
2. The assistant asks one or two questions at a time. Where it can, it offers **quick replies** as buttons: template choices, registered donation forms by name, recent photos as thumbnails.
3. Asha answers. The assistant proposes an outline ("Hero, short story, three numbers, donation form, questions and answers") with **Build it** and **Change the outline** buttons.
4. On **Build it**, the screen turns into the editor. The assistant tab stays open on the left. A checklist shows progress ("Adding the hero... done", "Writing the story... done", "Checking it on a phone..."). Each section glows on the canvas as it is added.
5. A **Stop** button is always visible while it works.
6. If a photo needs cropping or uploading, an inline card appears in the chat ("This photo needs cropping to fit the hero. Crop it now"). The assistant never crops on her behalf.
7. It finishes with a short summary and suggests the next step ("Want to check it on a phone, or submit it for approval?").
8. Every change line in the chat has its own **Undo**.

## 3. Edit an existing page by hand

1. Pages, search "winter", click **Winter appeal**.
2. The editor opens with the inspector closed and the left rail on **Outline** (not the assistant: people editing by hand should not feel pushed into chat).
3. A banner if the page is live: "You're editing a draft. The live page won't change until this is approved."
4. Click a heading on the canvas and type. Click a section to open its fields on the right.
5. The header shows "Saving..." then "Saved". There is no Save button to forget.
6. Ctrl or Cmd Z undoes, Shift added redoes.

## 4. Upload and crop a photo

1. In the hero's fields, **Change photo**, then drag a photo in (or pick from the media library). Dragging a photo straight onto the hero on the canvas works too.
2. An upload bar, then "Making web-friendly sizes..." for a few seconds.
3. If the shape does not fit the slot, the **crop dialog** opens straight away: the photo with a frame locked to the slot's shape, starting on the focal point, and small previews of how it will look on a computer and a phone. One button: **Use this crop**.
4. If the photo is too small: "This photo is 900 pixels wide. This space needs at least 1280, so it may look blurry on big screens. **Use it anyway** or **Choose another**."
5. Then alt text: "Describe the photo for people who can't see it." A **Suggest** button asks the assistant for a description. Or tick "Decorative only".

## 5. Submit for approval

1. **Submit for approval** (top right).
2. A small panel opens with:
   - an optional note to the approver,
   - a change summary written automatically ("Changed the headline, added a donation form"), which can be edited,
   - the checks as ticks and warnings. Blocking problems have a **Fix** link that jumps to the section.
3. **Submit**. The editor now says "Waiting for approval". Asha can keep editing, but the panel warns: "Editing now will withdraw it from approval. You can submit again."
4. Approvers get an email and a notification.

## 6. Approver reviews the changes

1. Spencer opens the email link (or the Approvals badge).
2. The review screen shows the page preview with the device switch, and a toggle: **Preview** or **Show changes**. In Show changes, changed sections are outlined and changed words highlighted in place; removed sections show as a thin "Removed: Quote" strip.
3. On the right: Asha's note, the list of changes (click one to scroll to it), check results, and comments.
4. He can pin a comment to a section ("Can we use a less sad photo here?").
5. **Send back** needs a comment. **Approve and publish** approves exactly what he is looking at.
6. If Asha edited the draft while he was looking, the screen says so and the approve button is disabled: "This page changed after it was submitted. It needs submitting again."

## 7. Publish

1. After approving, a progress strip with three steps: **Building**, **Going live**, **Clearing the cache**. Normally a few seconds.
2. Ends with "Live" and **View page**, which opens the real address.
3. Asha gets an email: "Winter appeal is live."
4. If something fails: plain words and what to do. For example: "The page is live, but we couldn't clear Cloudflare's cache, so some visitors may see the old version for a while. **Try again**, or tell an admin." The page stays approved and can be retried.

## 8. Fix a typo on a phone

1. Spencer spots a typo on the live site on his phone.
2. Opens the builder (signed in already; Access remembers the device for a while).
3. Search, tap the page. The mobile editor shows the page; he taps the paragraph and it opens in a full-screen text editor.
4. Fixes it, **Done**, then **Submit for approval**, or **Publish** if self-approval is on for the site.
5. The mobile mode only offers: find a page, edit text, swap a photo for one already uploaded, submit, review and approve. Everything else says "Open on a computer to do this".

## 9. Change the menu

1. Site parts > **Menus** > Main menu.
2. A simple list with drag handles and one level of indenting (one dropdown level).
3. **Add item**: search for a page by title, or add a web address. The label defaults to the page title.
4. A live preview of the header at computer and phone widths, including the phone menu opened.
5. A warning if an item points to a page that isn't live ("'Volunteer' is still a draft. The link won't work until it's live.").
6. **Submit for approval**, then the same review and publish as a page. Because the menu is on every page, the publish re-renders the whole site; the progress strip says so.

## 10. Roll back

**One page**

1. Edit page > **History** tab: a timeline of versions with who, when, a summary, and a "Live" marker.
2. Click a version to see it on the canvas (read-only, with a "Viewing version 14 from 3 Nov" bar).
3. **Restore this version** makes it the new draft. Then submit and approve as normal.

**Whole site (emergency, admins)**

1. Settings > Publishing: a list of releases with who, when and what changed.
2. **Roll back the site to this release**: a confirmation that lists what will change and asks for a reason.
3. It happens straight away, without a second approver. Approvers and admins get an email. The audit log records it.
4. Drafts made since are kept as drafts.
