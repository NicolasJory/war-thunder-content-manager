; Ajoute la page d'accueil à l'assistant.
;
; electron-builder ne la génère pas en mode assisté : l'installeur démarre
; directement sur le choix du dossier. Sans cette page, le panneau latéral
; (installerSidebar.bmp) n'est jamais affiché, puisque NSIS ne l'utilise que
; sur les pages d'accueil et de fin.
!macro customWelcomePage
  ; Trois lignes pour le titre au lieu de deux. « War Thunder Content Manager »
  ; est long, et le titre par défaut le fait déborder sur le paragraphe en
  ; dessous. Le réglage vaut pour toutes les langues de l'installeur, alors
  ; qu'un titre écrit en dur n'en servirait qu'une.
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !insertmacro MUI_PAGE_WELCOME
!macroend
