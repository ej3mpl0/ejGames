// Idioma del instalador: el de Windows (navigator.language) si es uno de los de ejGames; si no, inglés.
// La clave de cada texto es el propio texto en español; en español no se traduce nada.
// `tr(texto, ...args)` sustituye {0}, {1}…; `trErr(mensaje)` traduce también los errores del núcleo con su detalle.

const LANG = (() => {
  const l = (navigator.language || "en").toLowerCase();
  return ["es", "de", "fr", "zh", "ja", "pt"].find((c) => l.startsWith(c)) || "en";
})();
const LOCALE = { es: "es-ES", en: "en-US", de: "de-DE", fr: "fr-FR", zh: "zh-CN", ja: "ja-JP", pt: "pt-BR" }[LANG];

const STR = {
  "EJGAMES — INSTALADOR —": { en: "EJGAMES — INSTALLER —", de: "EJGAMES — INSTALLATION —", fr: "EJGAMES — INSTALLATION —", zh: "EJGAMES — 安装程序 —", ja: "EJGAMES — インストーラー —", pt: "EJGAMES — INSTALADOR —" },
  "Instalar ejGames": { en: "Install ejGames", de: "ejGames installieren", fr: "Installer ejGames", zh: "安装 ejGames", ja: "ejGames をインストール", pt: "Instalar o ejGames" },
  "Minimizar": { en: "Minimize", de: "Minimieren", fr: "Réduire", zh: "最小化", ja: "最小化", pt: "Minimizar" },
  "Cerrar": { en: "Close", de: "Schließen", fr: "Fermer", zh: "关闭", ja: "閉じる", pt: "Fechar" },
  "Instalación": { en: "Installation", de: "Installation", fr: "Installation", zh: "安装", ja: "インストール", pt: "Instalação" },
  "Instalar": { en: "Install", de: "Installieren", fr: "Installer", zh: "安装", ja: "インストール", pt: "Instalar" },
  "Actualizar": { en: "Update", de: "Aktualisieren", fr: "Mettre à jour", zh: "更新", ja: "更新", pt: "Atualizar" },
  "Reinstalar": { en: "Reinstall", de: "Neu installieren", fr: "Réinstaller", zh: "重新安装", ja: "再インストール", pt: "Reinstalar" },
  "Actualización": { en: "Update", de: "Aktualisierung", fr: "Mise à jour", zh: "更新", ja: "アップデート", pt: "Atualização" },
  "Reinstalación": { en: "Reinstallation", de: "Neuinstallation", fr: "Réinstallation", zh: "重新安装", ja: "再インストール", pt: "Reinstalação" },
  "Actualizando": { en: "Updating", de: "Wird aktualisiert", fr: "Mise à jour", zh: "正在更新", ja: "更新中", pt: "Atualizando" },
  "Instalando": { en: "Installing", de: "Wird installiert", fr: "Installation", zh: "正在安装", ja: "インストール中", pt: "Instalando" },
  "Terminado": { en: "Finished", de: "Fertig", fr: "Terminé", zh: "已完成", ja: "完了", pt: "Concluído" },
  "Error": { en: "Error", de: "Fehler", fr: "Erreur", zh: "错误", ja: "エラー", pt: "Erro" },
  "Destino": { en: "Destination", de: "Ziel", fr: "Destination", zh: "目标位置", ja: "保存先", pt: "Destino" },
  "cambiar": { en: "change", de: "ändern", fr: "changer", zh: "更改", ja: "変更", pt: "alterar" },
  "Espacio": { en: "Space", de: "Speicherplatz", fr: "Espace", zh: "空间", ja: "空き容量", pt: "Espaço" },
  "Extras": { en: "Extras", de: "Extras", fr: "Options", zh: "附加选项", ja: "追加オプション", pt: "Extras" },
  "Acceso directo": { en: "Shortcut", de: "Verknüpfung", fr: "Raccourci", zh: "快捷方式", ja: "ショートカット", pt: "Atalho" },
  "Abrir al terminar": { en: "Open when finished", de: "Nach Abschluss öffnen", fr: "Ouvrir à la fin", zh: "完成后打开", ja: "完了後に開く", pt: "Abrir ao terminar" },
  "· {0} libres": { en: "· {0} free", de: "· {0} frei", fr: "· {0} libres", zh: "· 可用 {0}", ja: "· 空き {0}", pt: "· {0} livres" },
  "Compilación de desarrollo: sin paquete": { en: "Development build: no package", de: "Entwicklungsversion: ohne Paket", fr: "Version de développement : sans paquet", zh: "开发版本：没有安装包", ja: "開発ビルド：パッケージなし", pt: "Compilação de desenvolvimento: sem pacote" },
  "Preparar el paquete": { en: "Preparing the package", de: "Paket vorbereiten", fr: "Préparation du paquet", zh: "正在准备安装包", ja: "パッケージを準備", pt: "Preparando o pacote" },
  "Copiar ejGames y sus temas": { en: "Copying ejGames and its themes", de: "ejGames und seine Designs kopieren", fr: "Copie d'ejGames et de ses thèmes", zh: "正在复制 ejGames 及其主题", ja: "ejGames とテーマをコピー", pt: "Copiando o ejGames e seus temas" },
  "Crear los accesos directos": { en: "Creating shortcuts", de: "Verknüpfungen erstellen", fr: "Création des raccourcis", zh: "正在创建快捷方式", ja: "ショートカットを作成", pt: "Criando os atalhos" },
  "Registrar la instalación": { en: "Registering the installation", de: "Installation registrieren", fr: "Enregistrement de l'installation", zh: "正在登记安装信息", ja: "インストールを登録", pt: "Registrando a instalação" },
  "Listo.": { en: "Done.", de: "Fertig.", fr: "Terminé.", zh: "完成。", ja: "完了。", pt: "Pronto." },
  "Abrir ejGames": { en: "Open ejGames", de: "ejGames öffnen", fr: "Ouvrir ejGames", zh: "打开 ejGames", ja: "ejGames を開く", pt: "Abrir o ejGames" },
  "cerrar": { en: "close", de: "schließen", fr: "fermer", zh: "关闭", ja: "閉じる", pt: "fechar" },
  "Instalado": { en: "Installed", de: "Installiert", fr: "Installé", zh: "已安装", ja: "インストール済み", pt: "Instalado" },
  "Error.": { en: "Error.", de: "Fehler.", fr: "Erreur.", zh: "错误。", ja: "エラー。", pt: "Erro." },
  "Reintentar": { en: "Try again", de: "Erneut versuchen", fr: "Réessayer", zh: "重试", ja: "再試行", pt: "Tentar novamente" },
  "Abriendo ejGames…": { en: "Opening ejGames…", de: "ejGames wird geöffnet…", fr: "Ouverture d'ejGames…", zh: "正在打开 ejGames…", ja: "ejGames を開いています…", pt: "Abrindo o ejGames…" },
  "Se abre solo en {0} s": { en: "Opens by itself in {0} s", de: "Öffnet sich in {0} s von selbst", fr: "S'ouvre seul dans {0} s", zh: "{0} 秒后自动打开", ja: "{0} 秒後に自動で開きます", pt: "Abre sozinho em {0} s" },
  "Carpeta de instalación": { en: "Installation folder", de: "Installationsordner", fr: "Dossier d'installation", zh: "安装文件夹", ja: "インストール先フォルダー", pt: "Pasta de instalação" },
  "ejGames <b>{0}</b> · tu biblioteca de juegos, con la cara de tu consola favorita.": { en: "ejGames <b>{0}</b> · your game library, with the look of your favourite console.", de: "ejGames <b>{0}</b> · deine Spielebibliothek im Look deiner Lieblingskonsole.", fr: "ejGames <b>{0}</b> · ta bibliothèque de jeux, avec le style de ta console préférée.", zh: "ejGames <b>{0}</b> · 你的游戏库，带有你喜爱的主机风格。", ja: "ejGames <b>{0}</b> · お気に入りの家庭用ゲーム機の雰囲気のゲームライブラリ。", pt: "ejGames <b>{0}</b> · sua biblioteca de jogos, com a cara do seu console favorito." },
  "De la <b>{0}</b> a la <b>{1}</b>. Tu biblioteca, horas y ajustes se quedan como están.": { en: "From <b>{0}</b> to <b>{1}</b>. Your library, hours and settings stay as they are.", de: "Von <b>{0}</b> auf <b>{1}</b>. Deine Bibliothek, Spielzeit und Einstellungen bleiben, wie sie sind.", fr: "De la <b>{0}</b> à la <b>{1}</b>. Ta bibliothèque, tes heures et tes réglages restent tels quels.", zh: "从 <b>{0}</b> 更新到 <b>{1}</b>。你的库、游戏时长和设置都会保留。", ja: "<b>{0}</b> から <b>{1}</b> へ。ライブラリ、プレイ時間、設定はそのまま残ります。", pt: "De <b>{0}</b> para <b>{1}</b>. Sua biblioteca, horas e configurações continuam como estão." },
  "Ya tienes la <b>{0}</b>. Reinstálala si algo no va bien: no se pierde nada.": { en: "You already have <b>{0}</b>. Reinstall it if something isn't working: nothing is lost.", de: "Du hast bereits <b>{0}</b>. Installiere sie neu, falls etwas nicht funktioniert: Es geht nichts verloren.", fr: "Tu as déjà la <b>{0}</b>. Réinstalle-la si quelque chose ne va pas : rien n'est perdu.", zh: "你已经安装了 <b>{0}</b>。如果有问题，可以重新安装，不会丢失任何数据。", ja: "<b>{0}</b> はすでにあります。問題があれば再インストールしてください。何も失われません。", pt: "Você já tem a <b>{0}</b>. Reinstale se algo não estiver funcionando: nada se perde." },
  "Tienes la <b>{0}</b>, más nueva que esta <b>{1}</b>. Si sigues, la sustituye.": { en: "You have <b>{0}</b>, newer than this <b>{1}</b>. If you continue, it will be replaced.", de: "Du hast <b>{0}</b>, neuer als diese <b>{1}</b>. Wenn du weitermachst, wird sie ersetzt.", fr: "Tu as la <b>{0}</b>, plus récente que cette <b>{1}</b>. Si tu continues, elle sera remplacée.", zh: "你安装的是 <b>{0}</b>，比这个 <b>{1}</b> 更新。继续的话会替换它。", ja: "お使いの <b>{0}</b> は、この <b>{1}</b> より新しいです。続行すると置き換えられます。", pt: "Você tem a <b>{0}</b>, mais nova que esta <b>{1}</b>. Se continuar, ela será substituída." },
  "ejGames <b>{0}</b> está listo. Tu biblioteca, horas y ajustes siguen como estaban.": { en: "ejGames <b>{0}</b> is ready. Your library, hours and settings are as they were.", de: "ejGames <b>{0}</b> ist bereit. Deine Bibliothek, Spielzeit und Einstellungen sind unverändert.", fr: "ejGames <b>{0}</b> est prêt. Ta bibliothèque, tes heures et tes réglages sont inchangés.", zh: "ejGames <b>{0}</b> 已就绪。你的库、游戏时长和设置保持不变。", ja: "ejGames <b>{0}</b> の準備ができました。ライブラリ、プレイ時間、設定はそのままです。", pt: "O ejGames <b>{0}</b> está pronto. Sua biblioteca, horas e configurações continuam como estavam." },
  "ejGames <b>{0}</b> ya está en el menú Inicio y en el escritorio.": { en: "ejGames <b>{0}</b> is in the Start menu and on the desktop.", de: "ejGames <b>{0}</b> ist im Startmenü und auf dem Desktop.", fr: "ejGames <b>{0}</b> est dans le menu Démarrer et sur le bureau.", zh: "ejGames <b>{0}</b> 已添加到开始菜单和桌面。", ja: "ejGames <b>{0}</b> はスタートメニューとデスクトップにあります。", pt: "O ejGames <b>{0}</b> está no menu Iniciar e na área de trabalho." },
  "ejGames <b>{0}</b> ya está en el menú Inicio.": { en: "ejGames <b>{0}</b> is in the Start menu.", de: "ejGames <b>{0}</b> ist im Startmenü.", fr: "ejGames <b>{0}</b> est dans le menu Démarrer.", zh: "ejGames <b>{0}</b> 已添加到开始菜单。", ja: "ejGames <b>{0}</b> はスタートメニューにあります。", pt: "O ejGames <b>{0}</b> está no menu Iniciar." },
  "Este instalador no lleva el paquete de ejGames.": { en: "This installer doesn't include the ejGames package.", de: "Dieser Installer enthält das ejGames-Paket nicht.", fr: "Cet installateur ne contient pas le paquet d'ejGames.", zh: "此安装程序不包含 ejGames 安装包。", ja: "このインストーラーには ejGames のパッケージが含まれていません。", pt: "Este instalador não tem o pacote do ejGames." },
  "Elige otra carpeta.": { en: "Choose another folder.", de: "Wähle einen anderen Ordner.", fr: "Choisissez un autre dossier.", zh: "请选择其他文件夹。", ja: "別のフォルダーを選んでください。", pt: "Escolha outra pasta." },
  "No se pudo preparar la instalación: {0}": { en: "Couldn't prepare the installation: {0}", de: "Die Installation konnte nicht vorbereitet werden: {0}", fr: "Impossible de préparer l'installation : {0}", zh: "无法准备安装：{0}", ja: "インストールの準備に失敗しました: {0}", pt: "Não foi possível preparar a instalação: {0}" },
  "No se pudo abrir el instalador: {0}": { en: "Couldn't open the installer: {0}", de: "Der Installer konnte nicht geöffnet werden: {0}", fr: "Impossible d'ouvrir l'installateur : {0}", zh: "无法打开安装程序：{0}", ja: "インストーラーを開けませんでした: {0}", pt: "Não foi possível abrir o instalador: {0}" },
  "La instalación se canceló. Si ejGames estaba abierto, ciérralo y vuelve a intentarlo.": { en: "The installation was cancelled. If ejGames was open, close it and try again.", de: "Die Installation wurde abgebrochen. Falls ejGames geöffnet war, schließe es und versuche es erneut.", fr: "L'installation a été annulée. Si ejGames était ouvert, ferme-le et réessaie.", zh: "安装已取消。如果 ejGames 正在运行，请先关闭它再重试。", ja: "インストールがキャンセルされました。ejGames が開いていた場合は閉じてから、もう一度お試しください。", pt: "A instalação foi cancelada. Se o ejGames estava aberto, feche-o e tente de novo." },
  "El instalador terminó con un error (código {0}).": { en: "The installer finished with an error (code {0}).", de: "Der Installer wurde mit einem Fehler beendet (Code {0}).", fr: "L'installateur s'est terminé avec une erreur (code {0}).", zh: "安装程序出错结束（代码 {0}）。", ja: "インストーラーがエラーで終了しました（コード {0}）。", pt: "O instalador terminou com um erro (código {0})." },
  "No se encuentra ejGames en la carpeta de instalación.": { en: "ejGames wasn't found in the installation folder.", de: "ejGames wurde im Installationsordner nicht gefunden.", fr: "ejGames est introuvable dans le dossier d'installation.", zh: "在安装文件夹中找不到 ejGames。", ja: "インストール先フォルダーに ejGames が見つかりません。", pt: "O ejGames não foi encontrado na pasta de instalação." },
  "No se pudo abrir ejGames: {0}": { en: "Couldn't open ejGames: {0}", de: "ejGames konnte nicht geöffnet werden: {0}", fr: "Impossible d'ouvrir ejGames : {0}", zh: "无法打开 ejGames：{0}", ja: "ejGames を開けませんでした: {0}", pt: "Não foi possível abrir o ejGames: {0}" },
};

// Texto traducido; {0}, {1}… se sustituyen por los argumentos.
function tr(s, ...args) {
  let out = STR[s]?.[LANG] ?? s;
  args.forEach((a, i) => { out = out.split(`{${i}}`).join(String(a)); });
  return out;
}

// Mensaje de error del núcleo: el texto fijo o la plantilla con su detalle ({0}) al final o en medio.
function trErr(msg) {
  const text = String(msg ?? "");
  if (STR[text]) return tr(text);
  for (const key of Object.keys(STR)) {
    if (!key.includes("{0}")) continue;
    const re = new RegExp("^" + key.split("{0}").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*)") + "$");
    const m = re.exec(text);
    if (m) return tr(key, m[1]);
  }
  return text;
}

// Textos fijos del HTML (y los atributos aria-label), antes de pintar.
function translateStatic() {
  document.documentElement.lang = LANG;
  document.title = tr(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue;
    const key = raw.trim();
    if (STR[key]) node.nodeValue = raw.replace(key, tr(key));
  }
  for (const el of document.querySelectorAll("[aria-label]")) el.setAttribute("aria-label", tr(el.getAttribute("aria-label")));
}
translateStatic();
