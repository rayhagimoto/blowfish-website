Some useful commands:

Compile tailwind css:
```
npx tailwindcss --config=tailwind.config.js --input=themes/blowfish/assets/css/main.css --output=assets/css/compiled/main.css
```

Deploy to netlify (this is how I've actually been publishing.)
```
netlify deploy --prod  
```

Local preview:
```
hugo server
```