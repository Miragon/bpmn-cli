export default async function coverCard(page) {
  await page.addStyleTag({
    content: `
      .VPNav, .VPLocalNav { display: none !important; }
      figure.window {
        position: fixed !important; left: 0; top: 0; z-index: 1000;
        width: 900px !important; border: 0 !important; border-radius: 0 !important;
      }
      figure.window .canvas { padding: 104px 48px !important; }
      figure.window .pane img { width: 540px !important; }
      figure.window .terminal { padding: 28px 48px 72px !important; font-size: 13px !important; background: var(--cd-ui-abschnitt) !important; }
      figure.window .line { white-space: pre !important; }
    `,
  })
}
