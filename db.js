const Datastore = require('nedb-promises');
const path = require('path');

const dir = path.join(__dirname, 'data');

const db = {
  users:       Datastore.create({ filename: path.join(dir, 'users.db'),       autoload: true }),
  services:    Datastore.create({ filename: path.join(dir, 'services.db'),    autoload: true }),
  clients:     Datastore.create({ filename: path.join(dir, 'clients.db'),     autoload: true }),
  quotes:      Datastore.create({ filename: path.join(dir, 'quotes.db'),      autoload: true }),
  quote_items: Datastore.create({ filename: path.join(dir, 'quote_items.db'), autoload: true }),
};

db.users.ensureIndex({ fieldName: 'email',  unique: true });
db.users.ensureIndex({ fieldName: 'slug',   unique: true });
db.quotes.ensureIndex({ fieldName: 'token', unique: true });

module.exports = db;
