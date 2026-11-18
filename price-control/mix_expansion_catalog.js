'use strict';
// Deliberately broad candidate discovery, not a product-to-price matcher.
// Saves original DocsInBox names so product variants can be reviewed before inclusion.
const FILTER=/(?:вырезк|щёч|щеч|щ[её]к|парме?зан|parmesan|грана\s*падано|пармск|прошут|prosciutto|тунц|тунец|tuna|саку|saku|утк|утин|ути[нк]|сибас|сибасс|seabass|камбал|flounder|палтус|лосос|семг|семг|salmon|индейк|индюш|сулугун|suluguni|дорад|дорад[оа]|анчоус|анчоус|анчов|аншоус|миндал|лепест|сосиск|пицц|горош|маслин|оливк|греч|грец|кремет|cremette|страчател|stracciatell|семол|semol|семолин|semolin|мук|терияк|teriyaki|киккоман|kikkoman|книги|смола|артишок|артистк|artichok|artichoke|лопатк|треск|cod\b|гребеш|scallop|грудк|филе)/i;
function norm(s){return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}
function classify(s){return FILTER.test(norm(s))?{id:'audit'}:null}
function iso(s){const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:''}
const round2=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
module.exports={PRODUCTS:[{id:'audit'}],norm,classify,iso,round2};
