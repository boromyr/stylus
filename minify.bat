@echo off
setlocal

@REM set "folder=%~dp0"
set "folder=C:\Users\PC\AppData\Local\Microsoft\Edge\User Data\Default\.extension\Stylus\"

for /r "%folder%" %%a in (*.js *.html *.css) do (
    echo Processing "%%a"...
    if "%%~xa" == ".js" (
        @REM echo -------JS-------
        uglifyjs "%%a" -c -m -o "%%a"
    ) else if "%%~xa" == ".html" (
        @REM echo -------HTML-------
        html-minifier --collapse-whitespace --remove-comments --remove-optional-tags --remove-redundant-attributes --minify-css true --minify-js true "%%a" -o "%%a"
    ) else if "%%~xa" == ".css" (
        @REM echo -------CSS-------
        cleancss -o "%%a" "%%a"
    )
)
