const dotenv = require('/opt/datafast/backend/node_modules/dotenv');
dotenv.config({ path: '/opt/datafast/backend/.env.production', override: true });
require('./dist/main');
