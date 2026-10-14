import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const { app, adminPath, usingDefaultPassword } = createApp();
app.listen(port, () => {
  console.log(`Portfolio:  http://localhost:${port}/`);
  console.log(`Dashboard:  http://localhost:${port}${adminPath}/`);
  if (usingDefaultPassword) console.warn('WARNING: ADMIN_PASSWORD not set, using the insecure default "change-me". Set it in the environment.');
});
