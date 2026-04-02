'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  RefreshCw, FileSpreadsheet, Eye, EyeOff, Search, X,
  Upload, ChevronDown, Users, AlertCircle, CheckCircle2,
  Percent, Tag, Plus, Trash2, Play,
} from 'lucide-react';

// ─── Column definitions ───────────────────────────────────────────────────────
// Blue  = from LinkedIn API
// Black = from BOD Ref Sheet
const COLS = [
  { key: 'accountId',         label: 'Account ID',          source: 'blue',  w: 115 },
  { key: 'campaignGroupId',   label: 'Campaign Group ID',   source: 'blue',  w: 140 },
  { key: 'campaignGroupName', label: 'Campaign Group Name', source: 'blue',  w: 220 },
  { key: 'category',          label: 'Category',            source: 'black', w: 140 },
  { key: 'io',                label: 'IO',                  source: 'black', w: 90  },
  { key: 'partner',           label: 'Partner',             source: 'black', w: 80  },
  { key: 'staffCode',         label: 'Staff Code',          source: 'black', w: 80  },
  { key: 'billingAgency',     label: 'Agency (Bill)',        source: 'black', w: 200 },
  { key: 'bookingAgency',     label: 'Booking Agency',      source: 'black', w: 200 },
  { key: 'advertiser',        label: 'Advertiser',          source: 'black', w: 170 },
  { key: 'industry',          label: 'Industry',            source: 'black', w: 130 },
  { key: 'ciNumber',          label: 'CI #',                source: 'black', w: 120 },
  { key: 'campStartDate',     label: 'Start Date',          source: 'blue',  w: 100 },
  { key: 'campEndDate',       label: 'End Date',            source: 'blue',  w: 100 },
  { key: 'adUnit',            label: 'Ad Unit',             source: 'blue',  w: 120 },
  { key: 'itemCode',          label: 'Item Code',           source: 'black', w: 200 },
  { key: 'mediaSpendUSD',     label: 'Media Spend USD',     source: 'blue',  w: 130, fmt: 'num2' },
  { key: 'pmfPercentage',     label: 'PMF %',               source: 'black', w: 80,  fmt: 'pct'  },
  { key: 'pmfUSD',            label: 'PMF USD',             source: 'black', w: 100, fmt: 'num2' },
  { key: 'exchangeRate',      label: 'Exchange Rate',       source: 'black', w: 110, fmt: 'num2' },
  { key: 'mediaSpendZAR',     label: 'Media Spend ZAR',     source: 'black', w: 130, fmt: 'num2' },
  { key: 'pmfZAR',            label: 'PMF ZAR',             source: 'black', w: 100, fmt: 'num2' },
  { key: 'grossZAR',          label: 'Gross ZAR',           source: 'black', w: 120, fmt: 'num2' },
  { key: 'specialNotes',      label: 'Special Notes',       source: 'black', w: 200 },
];

const BLUE_HDR   = '#00B0F0';
const BLACK_HDR  = '#595959';
const TOTAL_KEYS = new Set(['mediaSpendUSD','pmfUSD','mediaSpendZAR','pmfZAR','grossZAR']);
const DEFAULT_FX = 18;

// ─── Built-in excluded accounts (517 from Accounts_to_be_excluded.xlsx) ─
const BUILTIN_EXCLUDED    = [{"id":"503794842","billingAgency":"ACEteK Software Ltd","advertiser":"ACEtek Software Ltd"},{"id":"509245520","billingAgency":"Ad Dynamo International (Pty) Limited","advertiser":"Ad Dynamo"},{"id":"507933482","billingAgency":"Adine Abro Attorneys","advertiser":"Adine Abro Attorneys"},{"id":"507931815","billingAgency":"African Agricultural Technology Fund (AATF)","advertiser":"AATF"},{"id":"507929408","billingAgency":"African Elite Group Limited","advertiser":"African Elite Group Ltd"},{"id":"509239651","billingAgency":"Allan Gray Orbis Foundation Endowment Teaching Initiative t/a Jakes Gerwel Fellowship","advertiser":"Allan Gray Orbis Foundation Endowment Teaching Initiative"},{"id":"504946655","billingAgency":"Apptivate Africa LTD","advertiser":"Apptivate Africa"},{"id":"510292116","billingAgency":"Bangers & Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Durban University of Technology"},{"id":"504032229","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Iris Network systems"},{"id":"504032231","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Bangers & Mash"},{"id":"504938704","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Sutherland Bell"},{"id":"505500185","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"MMC"},{"id":"505523487","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Ensafrica"},{"id":"505524447","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Aspen Pharmacare"},{"id":"505530720","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Essential Cleaning Services"},{"id":"505548726","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"DSTV"},{"id":"505554490","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Tangent Solutions"},{"id":"505555491","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Gigabiz"},{"id":"505586419","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Jurumani"},{"id":"505593739","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Metrofibre networx"},{"id":"507919167","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Telkom Kenya"},{"id":"509238245","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"For a good mind"},{"id":"509305825","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Good Leaf"},{"id":"510234296","billingAgency":"Bangers and Mash (PTY) LIMITED t/a Bangers and Mash","advertiser":"Torque IT"},{"id":"504939595","billingAgency":"BDO South Africa t\\a BDO South Africa Services (Pty) Ltd","advertiser":"BDO South Africa Services (Pty) Ltd"},{"id":"509815509","billingAgency":"Black Ignition","advertiser":"KDS Direct"},{"id":"509916268","billingAgency":"Black Ignition","advertiser":"SA Fraud Prevention"},{"id":"509916309","billingAgency":"Black Ignition","advertiser":"Kemtek"},{"id":"508671188","billingAgency":"Blue Robot (Pty) Limited","advertiser":"Blue Robot"},{"id":"503862572","billingAgency":"Brand Spark DR Limited","advertiser":"DIB Bank Kenya Ltd"},{"id":"504943626","billingAgency":"Brand Spark DR Limited","advertiser":"Enwealth Financial Services LTD"},{"id":"504946240","billingAgency":"Brand Spark DR Limited","advertiser":"Wylde International"},{"id":"503896607","billingAgency":"BrandLife Limited","advertiser":"Allied Computers"},{"id":"504017421","billingAgency":"BrandLife Limited","advertiser":"Technology Distributions"},{"id":"504024497","billingAgency":"BrandLife Limited","advertiser":"Dreamworks"},{"id":"504046022","billingAgency":"BrandLife Limited","advertiser":"Office R Us"},{"id":"505502613","billingAgency":"BrandLife Limited","advertiser":"Compovine Technologies Limited"},{"id":"505526267","billingAgency":"BrandLife Limited","advertiser":"Tech Experience Center"},{"id":"505531604","billingAgency":"BrandLife Limited","advertiser":"Edgebase Technologies"},{"id":"507272264","billingAgency":"BrandLife Limited","advertiser":"Montos Dynamic Systems"},{"id":"507944544","billingAgency":"BrandLife Limited","advertiser":"Brandlife Digital"},{"id":"507963539","billingAgency":"BrandLife Limited","advertiser":"Lance Trend Limited"},{"id":"508773048","billingAgency":"BrandLife Limited","advertiser":"Brandlife Digital"},{"id":"509003882","billingAgency":"BrandLife Limited","advertiser":"Mitsumi Distribution"},{"id":"509225073","billingAgency":"BrandLife Limited","advertiser":"Amagnet Stores"},{"id":"509230069","billingAgency":"BrandLife Limited","advertiser":"Brandlife Digital"},{"id":"510616778","billingAgency":"BrandLife Limited","advertiser":"Arit of Africa"},{"id":"510631074","billingAgency":"BrandLife Limited","advertiser":"Large Michaels Limited"},{"id":"504013671","billingAgency":"Brightermonday Limited","advertiser":"BrighterMonday Kenya"},{"id":"504017007","billingAgency":"Business Partners International East Africa LLC","advertiser":"Business Partners International"},{"id":"507146118","billingAgency":"Capic SA (Pty) Ltd","advertiser":"Capic"},{"id":"509057566","billingAgency":"Career Connections Ltd","advertiser":"Career Connections Ltd"},{"id":"509212200","billingAgency":"Cash Connect Management Solutions","advertiser":"Connect"},{"id":"509234719","billingAgency":"Cash Connect Management Solutions","advertiser":"Connect"},{"id":"505569543","billingAgency":"Centonomy Ltd","advertiser":"Centonomy Ltd"},{"id":"507864527","billingAgency":"ChangeFolio South AFrica","advertiser":"Changefolio"},{"id":"503745827","billingAgency":"Channel Center (PTY) LTD","advertiser":"Channel Centre"},{"id":"510632893","billingAgency":"Christodoulou & Mavrikis Inc t/a C&M Attorneys","advertiser":"Christodoulou & Mavrikis Inc"},{"id":"504947720","billingAgency":"Cinnabar Investment Management (Pty) Ltd","advertiser":"Cinnabar Investment Management (Pty) Ltd"},{"id":"508296397","billingAgency":"CIPS Southern Africa (Pty) Ltd","advertiser":"CIPS Southern Africa (Pty) Ltd"},{"id":"510227140","billingAgency":"Clarity Global Strategic Communication t/a Clarity Global","advertiser":"Clarity Global"},{"id":"507825675","billingAgency":"Comoonicate Consulting","advertiser":"1Life"},{"id":"508001007","billingAgency":"Conversion Media (Pty) Ltd","advertiser":"UCT Graduate School of Business"},{"id":"508100798","billingAgency":"Conversion Media (Pty) Ltd","advertiser":"Conversion Science"},{"id":"509086574","billingAgency":"Crew for a Cause","advertiser":"Crew for a Cause"},{"id":"502417264","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Hogan Lovells"},{"id":"503794097","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"TWW Crew"},{"id":"503815772","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Tshwane Automotive"},{"id":"503843375","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Rialheim"},{"id":"503857179","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Macsteel"},{"id":"503880603","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Boomtown agency"},{"id":"504010086","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Excellus"},{"id":"504014198","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Nelson Mandela University"},{"id":"504054940","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"INSPECTACAR"},{"id":"504906319","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"One Vault"},{"id":"504923886","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Tarsus"},{"id":"504967373","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Debt Movement"},{"id":"508119178","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Sanral"},{"id":"508131251","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Shoprite"},{"id":"508131260","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Datacore"},{"id":"508143599","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"Datacore"},{"id":"508222212","billingAgency":"Datacore Media (Pty) Ltd","advertiser":"IISA"},{"id":"507944863","billingAgency":"Datamuse Limited","advertiser":"Hyve Group"},{"id":"509360131","billingAgency":"Datamuse Limited","advertiser":"Hyve Group"},{"id":"509979056","billingAgency":"Datamuse Limited","advertiser":"Hyve Group"},{"id":"505575080","billingAgency":"DD New Media t/a New Media Design","advertiser":"Elephant Lifting Equipment"},{"id":"503630316","billingAgency":"Demographica (Pty) Ltd","advertiser":"Maersk Drilling"},{"id":"55501921","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"502416165","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"IFS"},{"id":"502682457","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"BMW"},{"id":"503173764","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"SAB"},{"id":"503221397","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"503396424","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Standard Chartered Kenya"},{"id":"503737944","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Jaguar Land Rover South Africa"},{"id":"503742033","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Jaguar Land Rover South Africa"},{"id":"503752432","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Microsoft"},{"id":"503815711","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Jaguar Land Rover South Africa"},{"id":"503853401","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Engen"},{"id":"504050197","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Microsoft"},{"id":"504916201","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"International Cycling Executives (ICE)"},{"id":"505501921","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"505588462","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"IFS"},{"id":"505591781","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Multichoice"},{"id":"506279943","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Jaguar Land Rover South Africa"},{"id":"506799293","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Jaguar Land Rover South Africa"},{"id":"507205520","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507742452","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Coronation Fund Managers"},{"id":"507946916","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507947861","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507947863","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507947882","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507950436","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507950446","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507950449","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"507953189","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"ABSA"},{"id":"508251494","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"BMW"},{"id":"509696154","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Giraffe & Co"},{"id":"509698049","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"Mini"},{"id":"510288316","billingAgency":"Dentsu Central Services (PTY) LTD","advertiser":"UCT D-School"},{"id":"507150937","billingAgency":"Derivco Pty Ltd","advertiser":"Derivco"},{"id":"503851017","billingAgency":"Digital Foundation Africa","advertiser":"Digital Foundation Africa"},{"id":"504011314","billingAgency":"Direct - Amalgam Leadership Group","advertiser":"Direct - Amalgam Leadership Group"},{"id":"505558237","billingAgency":"Discmen Entertainment Ltd","advertiser":"Discmen Entertainment"},{"id":"508166587","billingAgency":"Discovery Central Services (Pty) Limited","advertiser":"LA Health"},{"id":"508132122","billingAgency":"Dragonfly Limited","advertiser":"Ngao Credit Limited"},{"id":"509206871","billingAgency":"Econorisk Pty Ltd","advertiser":"Econorisk"},{"id":"508114841","billingAgency":"Effectus Group (Pty) Ltd","advertiser":"Transcend"},{"id":"503599716","billingAgency":"EGM Securities Limited","advertiser":"EGM Securities"},{"id":"503851586","billingAgency":"Emunah Concepts (Pty) Ltd","advertiser":"Action COACH"},{"id":"507209227","billingAgency":"EPI-USE Africa (Pty) Ltd","advertiser":"EPI-USE Labs Webinar"},{"id":"508293391","billingAgency":"Explore Software Pty Ltd t/a Explore Data Science Academy","advertiser":"Explore Data Science"},{"id":"507924513","billingAgency":"Fanaka Real Estate LTD","advertiser":"Fanaka Real Estate"},{"id":"508231659","billingAgency":"Farmerline Limited","advertiser":"Farmerline Video Campaign"},{"id":"508258941","billingAgency":"Fedgroup Holdings (PTY) LTD","advertiser":"Fedgroup Holdings (PTY) LTD"},{"id":"503855592","billingAgency":"Flume Communications (Pty) Ltd LI Lite","advertiser":"Nedbank Private Wealth"},{"id":"504941936","billingAgency":"GCI Wealth (Pty) Ltd","advertiser":"GCI Wealth (Pty) Ltd"},{"id":"503736393","billingAgency":"Genghis Capital Ltd","advertiser":"Hass Consult"},{"id":"503752763","billingAgency":"Genghis Capital Ltd","advertiser":"Ecobank KE"},{"id":"503828532","billingAgency":"Genghis Capital Ltd","advertiser":"Genghis Capital Ltd"},{"id":"509921774","billingAgency":"Gogaga","advertiser":"Gogaga"},{"id":"504048281","billingAgency":"Gone Digital (Pty) Ltd t/a Gone Digital","advertiser":"PRINCIPA"},{"id":"504048282","billingAgency":"Gone Digital (Pty) Ltd t/a Gone Digital","advertiser":"CASEWEAR"},{"id":"504049216","billingAgency":"Gone Digital (Pty) Ltd t/a Gone Digital","advertiser":"WISENET"},{"id":"504053035","billingAgency":"Gone Digital (Pty) Ltd t/a Gone Digital","advertiser":"RESOLUTION CIRCLE"},{"id":"503688171","billingAgency":"Gromat (Pty) Ltd","advertiser":"Rawson Developers"},{"id":"509025052","billingAgency":"Groundflr","advertiser":"Groundflr"},{"id":"503795848","billingAgency":"Havas Media South Africa (Pty) Ltd","advertiser":"Development Bank of Southern Africa"},{"id":"505554693","billingAgency":"Havas Media South Africa (Pty) Ltd","advertiser":"Prudential"},{"id":"505555723","billingAgency":"Havas Media South Africa (Pty) Ltd","advertiser":"Prudential"},{"id":"505556657","billingAgency":"Havas Media South Africa (Pty) Ltd","advertiser":"Prudential"},{"id":"507140867","billingAgency":"Havas Media South Africa (Pty) Ltd","advertiser":"Vivo energy"},{"id":"507906102","billingAgency":"Havas Media South Africa (Pty) Ltd","advertiser":"Mineworkers Investment Company"},{"id":"503757871","billingAgency":"HKLM Connect","advertiser":"Renergen"},{"id":"504054484","billingAgency":"HKLM Connect","advertiser":"JBS"},{"id":"506801866","billingAgency":"HKLM Connect","advertiser":"Richfield"},{"id":"508986120","billingAgency":"HKLM Connect","advertiser":"MAA Awards"},{"id":"504034653","billingAgency":"Hoorah Digital (Pty) Ltd","advertiser":"Pilot Crush Tec"},{"id":"504943132","billingAgency":"Hoorah Digital (Pty) Ltd","advertiser":"Multichoice"},{"id":"507236577","billingAgency":"Hoorah Digital (Pty) Ltd","advertiser":"African Data Centres"},{"id":"507836760","billingAgency":"Hoorah Digital (Pty) Ltd","advertiser":"GIBBS"},{"id":"507886269","billingAgency":"Hoorah Digital (Pty) Ltd","advertiser":"Nedbank"},{"id":"508153145","billingAgency":"Hoorah Digital (Pty) Ltd","advertiser":"American Express"},{"id":"508192113","billingAgency":"Hoorah Digital (Pty) Ltd","advertiser":"Legacy Capital"},{"id":"507935348","billingAgency":"Hybrid Media","advertiser":"Objekt"},{"id":"503829095","billingAgency":"i Lead Online (PTY) LTD t/a i Lead et al","advertiser":"Fortress"},{"id":"507153173","billingAgency":"Ignition Marketing International (Pty) Ltd","advertiser":"Ignition Marketing International"},{"id":"507904300","billingAgency":"iLearn Corporate Services t/a iLearn SA","advertiser":"iLearn Corporate Services (PTY) LTD"},{"id":"50869003","billingAgency":"Imagine This Digital (Pty) Ltd","advertiser":"ArmourTek"},{"id":"508292321","billingAgency":"Ince Proprietary Limited t/a Ince (PTY) Ltd","advertiser":"Ince"},{"id":"504055044","billingAgency":"Initiative Media South Africa (Pty) Ltd","advertiser":"Bluecode Africa"},{"id":"505593250","billingAgency":"Initiative Media South Africa (Pty) Ltd","advertiser":"Eduvos"},{"id":"509468025","billingAgency":"Intimedia","advertiser":"Peregine Capital"},{"id":"503746022","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"503787542","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"503787759","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"503788447","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"503790532","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"503791457","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"503794500","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"504919885","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"504926078","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"507603167","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"507892854","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"507913508","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"507985538","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"508234404","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"509040180","billingAgency":"Investec Bank Limited","advertiser":"Investec"},{"id":"504915775","billingAgency":"iOCO","advertiser":"iOCO Solutions GmbH"},{"id":"503763386","billingAgency":"iProspect","advertiser":"ABSA KENYA"},{"id":"503884574","billingAgency":"iProspect","advertiser":"Volkswagen"},{"id":"504000036","billingAgency":"iProspect","advertiser":"DMX"},{"id":"504059305","billingAgency":"iProspect","advertiser":"Trident Trust"},{"id":"504099913","billingAgency":"iProspect","advertiser":"Toshiba Corporation"},{"id":"509018637","billingAgency":"iStore Business (Core Group)","advertiser":"iStore"},{"id":"505533844","billingAgency":"ITR Technology PTY Ltd","advertiser":"ITR Technology"},{"id":"509078357","billingAgency":"Juno Media (Pty) Ltd","advertiser":"Netcare"},{"id":"509999503","billingAgency":"Juno Media (Pty) Ltd","advertiser":"SHIFT"},{"id":"510226018","billingAgency":"Juno Media (Pty) Ltd","advertiser":"The Unlimited"},{"id":"509042762","billingAgency":"K2014266944 (SOUTH AFRICA) (PTY) LTD t/a HyperionDev","advertiser":"Hyperion Dev"},{"id":"510210230","billingAgency":"Kawai Consulting","advertiser":"Kawai Consulting"},{"id":"504962956","billingAgency":"Kenya Airways PLC","advertiser":"Kenya Airways"},{"id":"503879425","billingAgency":"KEP Services Ltd","advertiser":"Kep Services Ltd"},{"id":"503354666","billingAgency":"King Price Insurance Company Ltd","advertiser":"KING PRICE INSURANCE"},{"id":"504041092","billingAgency":"King Price Insurance Company Ltd","advertiser":"KING PRICE INSURANCE"},{"id":"507948708","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"507948971","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"507950452","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"507953373","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"507954325","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"507963113","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"508780862","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"508783797","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"508785739","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"508785753","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"509226768","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"509466294","billingAgency":"LKDA Network CC","advertiser":"Shumani Industrial Equipment"},{"id":"509926728","billingAgency":"LKDA Network CC","advertiser":"Nissan"},{"id":"510281042","billingAgency":"LKDA Network CC","advertiser":"Nissan Angola"},{"id":"510447615","billingAgency":"LKDA Network CC","advertiser":"atWork"},{"id":"510449352","billingAgency":"LKDA Network CC","advertiser":"Goscor Access Solutions"},{"id":"503827760","billingAgency":"LS Communications (Pty) Ltd","advertiser":"City of Cape Town"},{"id":"507207791","billingAgency":"LS Communications (Pty) Ltd","advertiser":"Zendier Dental Care"},{"id":"510286698","billingAgency":"Lumenii Pty Ltd","advertiser":"Luminii"},{"id":"508219358","billingAgency":"Magnesium Tech (Pty) Ltd","advertiser":"Engage"},{"id":"503821639","billingAgency":"Mark1 Media and Consulting","advertiser":"Tshwane Automotive"},{"id":"503886332","billingAgency":"Mark1 Media and Consulting","advertiser":"SAIPA"},{"id":"503893617","billingAgency":"Mark1 Media and Consulting","advertiser":"Riscura"},{"id":"504005842","billingAgency":"Mark1 Media and Consulting","advertiser":"SA Digital Villiages"},{"id":"504011090","billingAgency":"Mark1 Media and Consulting","advertiser":"ENCA"},{"id":"504965119","billingAgency":"Mark1 Media and Consulting","advertiser":"Braintree by Vox"},{"id":"504989827","billingAgency":"Mark1 Media and Consulting","advertiser":"Anova Health Institute"},{"id":"505500661","billingAgency":"Mark1 Media and Consulting","advertiser":"Mark 1"},{"id":"506343962","billingAgency":"Mark1 Media and Consulting","advertiser":"V&A Waterfront"},{"id":"507047903","billingAgency":"Mark1 Media and Consulting","advertiser":"Liquid Telecom"},{"id":"507115595","billingAgency":"Mark1 Media and Consulting","advertiser":"YouTility"},{"id":"507205929","billingAgency":"Mark1 Media and Consulting","advertiser":"Satrix"},{"id":"507267788","billingAgency":"Mark1 Media and Consulting","advertiser":"MFS Africa"},{"id":"507268803","billingAgency":"Mark1 Media and Consulting","advertiser":"Abbott Diagnostics"},{"id":"507297462","billingAgency":"Mark1 Media and Consulting","advertiser":"Citadel Investment Services"},{"id":"507759905","billingAgency":"Mark1 Media and Consulting","advertiser":"Vox Telecoms"},{"id":"507874487","billingAgency":"Mark1 Media and Consulting","advertiser":"Proudly South African"},{"id":"508254691","billingAgency":"Mark1 Media and Consulting","advertiser":"Volvo"},{"id":"508278269","billingAgency":"Mark1 Media and Consulting","advertiser":"Cat Phones"},{"id":"508913540","billingAgency":"Mark1 Media and Consulting","advertiser":"Cloudmania"},{"id":"508931590","billingAgency":"Mark1 Media and Consulting","advertiser":"REMAX of Southern Africa"},{"id":"509031639","billingAgency":"Mark1 Media and Consulting","advertiser":"Touchsides"},{"id":"509044941","billingAgency":"Mark1 Media and Consulting","advertiser":"Citadel Global"},{"id":"509917957","billingAgency":"Mark1 Media and Consulting","advertiser":"Equites"},{"id":"509949258","billingAgency":"Mark1 Media and Consulting","advertiser":"Core Group"},{"id":"509098284","billingAgency":"Media 24","advertiser":"Media 24 {Fairlady}"},{"id":"503844122","billingAgency":"Mediacom","advertiser":"Coca Cola"},{"id":"503871041","billingAgency":"Mediacom","advertiser":"Siemens"},{"id":"508900141","billingAgency":"Mediology","advertiser":"Tongaat Hulett"},{"id":"509008747","billingAgency":"Mediology","advertiser":"Japan Tobacco International"},{"id":"509053784","billingAgency":"Mediology","advertiser":"Boucher Legacy"},{"id":"509935826","billingAgency":"Mediology","advertiser":"Bridgestone"},{"id":"503268879","billingAgency":"Mercurial Media","advertiser":"Petco"},{"id":"504963698","billingAgency":"Mercurial Media","advertiser":"The Innovation Hub"},{"id":"503630824","billingAgency":"Mindshare - Jhb","advertiser":"Standard Bank"},{"id":"503792492","billingAgency":"Mindshare - Jhb","advertiser":"Standard Bank"},{"id":"503808406","billingAgency":"Mindshare - Jhb","advertiser":"Volvo"},{"id":"503830619","billingAgency":"Mindshare - Jhb","advertiser":"Standard Bank"},{"id":"503853728","billingAgency":"Mindshare - Jhb","advertiser":"Sage"},{"id":"507492022","billingAgency":"Mindshare - Jhb","advertiser":"Standard Bank"},{"id":"507957991","billingAgency":"Mindshare - Jhb","advertiser":"Sage"},{"id":"507995673","billingAgency":"Mindshare - Jhb","advertiser":"Avon"},{"id":"508075545","billingAgency":"Mindshare - Jhb","advertiser":"Sage"},{"id":"508360707","billingAgency":"Mindshare - Jhb","advertiser":"IBM"},{"id":"509278340","billingAgency":"Mindshare - Jhb","advertiser":"Aware.Org"},{"id":"509583397","billingAgency":"Mindshare - Jhb","advertiser":"Ford"},{"id":"509918989","billingAgency":"Mindshare - Jhb","advertiser":"Standard Bank"},{"id":"510652755","billingAgency":"Mindshare - Jhb","advertiser":"Ford"},{"id":"510679341","billingAgency":"Mindshare - Jhb","advertiser":"Standard Bank"},{"id":"510688798","billingAgency":"Mindshare - Jhb","advertiser":"Standard Bank"},{"id":"504984809","billingAgency":"Minerva Books CC","advertiser":"Minerva Books CC"},{"id":"509869957","billingAgency":"Miway Insurance Ltd","advertiser":"Mi-Way Insurance Limited"},{"id":"507167617","billingAgency":"Mix Digital (Pty) Ltd - GREYSKULL","advertiser":"Talisman"},{"id":"508054927","billingAgency":"Mix Digital (Pty) Ltd - GREYSKULL","advertiser":"Bridgestone"},{"id":"509621071","billingAgency":"Mix Digital (Pty) Ltd - GREYSKULL","advertiser":"IDC"},{"id":"503698949","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Telkom"},{"id":"503770977","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"La Gare"},{"id":"503837635","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Telkom"},{"id":"503879058","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Visa"},{"id":"504059300","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Visa"},{"id":"505524144","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Nedgroup Investments International"},{"id":"505583771","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Nedbank"},{"id":"506978747","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Visa"},{"id":"507184941","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Nedbank"},{"id":"507188874","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Nedbank CIB"},{"id":"507190765","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Nedbank"},{"id":"507463258","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Dimension Data"},{"id":"507747433","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Openserve"},{"id":"507818682","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Nedgroup"},{"id":"507959203","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Nedbank Private Wealth"},{"id":"508032841","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Santam"},{"id":"508059456","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Varsity College"},{"id":"508111512","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Santam"},{"id":"508174280","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Elite Risk"},{"id":"508285701","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"BCX"},{"id":"508340340","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"SHA Risk Specialists"},{"id":"509585174","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Karcher"},{"id":"510229312","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Jeep"},{"id":"510245200","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Pnet"},{"id":"511472377","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Samsung"},{"id":"511495237","billingAgency":"MMS Communications (Pty) Ltd","advertiser":"Visa"},{"id":"509947057","billingAgency":"Namibia Future Media Holdings (Pty) Ltd","advertiser":"Woerman Brock"},{"id":"510679477","billingAgency":"Namibia Future Media Holdings (Pty) Ltd","advertiser":"APS"},{"id":"504919107","billingAgency":"Nation Media Group PLC t/a Tag Brand Group","advertiser":"Traction School of Governance"},{"id":"508248925","billingAgency":"Nation Media Group PLC t/a Tag Brand Group","advertiser":"Scribe"},{"id":"508294057","billingAgency":"Nation Media Group PLC t/a Tag Brand Group","advertiser":"Nation Media Group"},{"id":"510215417","billingAgency":"Nation Media Group PLC t/a Tag Brand Group","advertiser":"Fair Trade Market Place"},{"id":"510292903","billingAgency":"Nation Media Group PLC t/a Tag Brand Group","advertiser":"Kenya Revenue Authority (KRA)"},{"id":"503294437","billingAgency":"National Positions SA (PTY) LTD","advertiser":"University of Pretoria"},{"id":"503298396","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Kimberley Clarke"},{"id":"503337086","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Proud Afrique"},{"id":"503530660","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Konica Minolta"},{"id":"503722997","billingAgency":"National Positions SA (PTY) LTD","advertiser":"SA Medical Association"},{"id":"503812902","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Dr Bawa"},{"id":"504963627","billingAgency":"National Positions SA (PTY) LTD","advertiser":"National Positions SA PTY LTD"},{"id":"506355189","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Warehouse RSA"},{"id":"508093535","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Tshwane University"},{"id":"508104580","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Gestalt Growth Strategy"},{"id":"508270502","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Tiger Brands"},{"id":"508760014","billingAgency":"National Positions SA (PTY) LTD","advertiser":"Kimberley Clarke"},{"id":"509559979","billingAgency":"National Positions SA (PTY) LTD","advertiser":"SA Investment conference"},{"id":"509978885","billingAgency":"National Positions SA (PTY) LTD","advertiser":"DGB"},{"id":"510218126","billingAgency":"National Positions SA (PTY) LTD","advertiser":"CIDB"},{"id":"510240477","billingAgency":"National Positions SA (PTY) LTD","advertiser":"The Presidency SA"},{"id":"507953905","billingAgency":"Nendo Limited","advertiser":"AYuTE Africa"},{"id":"503828606","billingAgency":"Nettrade (Pty) Ltd","advertiser":"Nigeria Solidarity Fund"},{"id":"504042021","billingAgency":"Nettrade (Pty) Ltd","advertiser":"Codebase Technologies"},{"id":"504992195","billingAgency":"Nettrade (Pty) Ltd","advertiser":"Wayout Intl AB"},{"id":"505548170","billingAgency":"Nettrade (Pty) Ltd","advertiser":"Proof of Impact"},{"id":"507892448","billingAgency":"Nettrade (Pty) Ltd","advertiser":"MTN"},{"id":"508108893","billingAgency":"Nettrade (Pty) Ltd","advertiser":"MTN"},{"id":"508251062","billingAgency":"Nettrade (Pty) Ltd","advertiser":"Nettrade Programmatic"},{"id":"508829187","billingAgency":"NMG Benefits","advertiser":"NMG Benefits"},{"id":"509274085","billingAgency":"NY Media","advertiser":"Kilima Private Game Reserve"},{"id":"504906999","billingAgency":"OfferZen B.V","advertiser":"Offerzen"},{"id":"509022442","billingAgency":"OfferZen B.V","advertiser":"Offerzen"},{"id":"503285011","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Standard Bank"},{"id":"503371273","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Credit Guarantee Insurance Company"},{"id":"503451569","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Actros"},{"id":"503674135","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Standard Bank"},{"id":"503886296","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Stanlib"},{"id":"505503924","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"MTN"},{"id":"507203409","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"AEG"},{"id":"507244539","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Milpark Business School"},{"id":"507428981","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Standard Bank"},{"id":"507464435","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"HP"},{"id":"508192184","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Porsche SA"},{"id":"508192185","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"BestMed"},{"id":"508233420","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Fuso"},{"id":"508246529","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Standard Bank"},{"id":"508272098","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"MTN"},{"id":"603151429","billingAgency":"Omnicom Media Group SA (Pty) LTD","advertiser":"Mercedes South Africa"},{"id":"505523729","billingAgency":"Outsurance Insurance Company Limited","advertiser":"Outvest"},{"id":"507968874","billingAgency":"Oxbridge Academy Pty Ltd","advertiser":"Oxbridge Academy"},{"id":"507970735","billingAgency":"Oxbridge Academy Pty Ltd","advertiser":"Mindsharp"},{"id":"502866716","billingAgency":"Oxygene Marketing Communication Limited","advertiser":"African Economic Research Consortium (AERC)"},{"id":"503889786","billingAgency":"Oxygene Marketing Communication Limited","advertiser":"Mitchell Cotts Group"},{"id":"504006463","billingAgency":"Oxygene Marketing Communication Limited","advertiser":"Securex Agencies"},{"id":"508223239","billingAgency":"Oxygene Marketing Communication Limited","advertiser":"inAble"},{"id":"508316667","billingAgency":"Oxygene Marketing Communication Limited","advertiser":"KBL"},{"id":"509363369","billingAgency":"Oxygene Marketing Communication Limited","advertiser":"Pathologists Lancet Kenya (PLK)"},{"id":"510200444","billingAgency":"Oxygene Marketing Communication Limited","advertiser":"Mozilla Lean Data Practices"},{"id":"507982624","billingAgency":"Pam Golding Properties-Kenya","advertiser":"Pam Golding Properties-Kenya"},{"id":"503425520","billingAgency":"Park Advertising","advertiser":"Mugg & Bean"},{"id":"505558315","billingAgency":"Park Advertising","advertiser":"FedEx"},{"id":"504006873","billingAgency":"Peach Bots (Pty) Ltd t/a FinChatBot","advertiser":"Finchatbot"},{"id":"503747327","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"TMARC"},{"id":"503752606","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"RMB"},{"id":"504014287","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"Messe Frankfurt"},{"id":"504017226","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"All Fashion Sourcing"},{"id":"504034700","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"Messe Frankfurt"},{"id":"504035161","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"Messe Frankfurt"},{"id":"504907923","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"World Gold Council"},{"id":"504979391","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"Healthbridge"},{"id":"505558974","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"World Gold Council"},{"id":"505559965","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"World Gold Council"},{"id":"505574315","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"RMB"},{"id":"507436291","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"RMB"},{"id":"507936745","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"The Pro Business Diploma - Prospecting"},{"id":"507959788","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"World Gold Council"},{"id":"508328582","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"Relativ Media"},{"id":"508334223","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"P5"},{"id":"508754949","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"RMB"},{"id":"508754951","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"RMB"},{"id":"508759660","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"RMB"},{"id":"508760587","billingAgency":"Platform 5 Technologies (Pty) Ltd t/a AKQA","advertiser":"RMB"},{"id":"507144905","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Wesbank"},{"id":"507146413","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Plus1X Solutions"},{"id":"507278648","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Tax Ombud"},{"id":"507281102","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"SelectOne"},{"id":"508923644","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Woodridge"},{"id":"509043793","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"RMA"},{"id":"509052750","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Plus1X Solutions"},{"id":"509999140","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Transcend"},{"id":"510232090","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"JBS"},{"id":"510236095","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Wits"},{"id":"510270500","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Giant Leap"},{"id":"510277227","billingAgency":"Plus1X Solutions (Pty) Ltd","advertiser":"Chair Club"},{"id":"504979060","billingAgency":"Popimedia","advertiser":"Flight Centre"},{"id":"504970953","billingAgency":"PressPack Media (Pty) Ltd t/a Fox Street Communications","advertiser":"Charities Aid Foundation Southern Africa"},{"id":"504008330","billingAgency":"Presta Capital Limited","advertiser":"PRESTA AFRICA"},{"id":"503264528","billingAgency":"QM Media (Pty) Ltd t/a Kintaro","advertiser":"Sanlam Private Wealth"},{"id":"509046314","billingAgency":"QM Media (Pty) Ltd t/a Kintaro","advertiser":"PPC Cement"},{"id":"503792178","billingAgency":"Red Ribbon Communications CC","advertiser":"Nclose"},{"id":"503818877","billingAgency":"Red Ribbon Communications CC","advertiser":"ESG Cloud"},{"id":"504916935","billingAgency":"Red Ribbon Communications CC","advertiser":"Cyber Security South Africa"},{"id":"508254489","billingAgency":"Red Ribbon Communications CC","advertiser":"Grasp Data"},{"id":"508255648","billingAgency":"Red Ribbon Communications CC","advertiser":"Red Ribbon Communications"},{"id":"508256530","billingAgency":"Red Ribbon Communications CC","advertiser":"Solve Business Consulting"},{"id":"508257500","billingAgency":"Red Ribbon Communications CC","advertiser":"Digiata"},{"id":"508315353","billingAgency":"Red Ribbon Communications CC","advertiser":"EHS Cloud"},{"id":"508317129","billingAgency":"Red Ribbon Communications CC","advertiser":"Nosa"},{"id":"507928064","billingAgency":"Right Click Media South African","advertiser":"Vox Telecoms"},{"id":"503268821","billingAgency":"Safaricom PLC","advertiser":"Safaricom"},{"id":"503664796","billingAgency":"Safaricom PLC","advertiser":"Safaridotcom"},{"id":"507753828","billingAgency":"Safaricom PLC","advertiser":"Safaricom"},{"id":"508061704","billingAgency":"SAME Foundation","advertiser":"The Same Foundation"},{"id":"504004719","billingAgency":"Sendy Kenya Freight Ltd","advertiser":"Sendy Kenya Freight"},{"id":"504998169","billingAgency":"So Interactive Web Designs CC","advertiser":"So Interactive Web Designs CC"},{"id":"504999220","billingAgency":"So Interactive Web Designs CC","advertiser":"So Interactive Web Designs CC"},{"id":"505559320","billingAgency":"So Interactive Web Designs CC","advertiser":"So Interactive Web Designs CC"},{"id":"509088569","billingAgency":"Solis Ltd","advertiser":"Solid Limited"},{"id":"504085410","billingAgency":"Southpoint Management Services (Pty) Ltd","advertiser":"South Point"},{"id":"507992575","billingAgency":"Spark Media a division of CTP Limited","advertiser":"Spark Media"},{"id":"508017255","billingAgency":"Spark Media a division of CTP Limited","advertiser":"Spark Media"},{"id":"507520315","billingAgency":"Spitfire Inbound","advertiser":"Barloworld Equipment"},{"id":"503778001","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"FNB South Africa"},{"id":"504965563","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia DENMARK"},{"id":"505594617","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Wesbank"},{"id":"507191031","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia SWEDEN"},{"id":"507913076","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"INSPECTACAR"},{"id":"507952011","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Sprout Performance Partners (Pty) Ltd"},{"id":"508031810","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Old Mutual"},{"id":"508038323","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Old Mutual Investment Group"},{"id":"508833703","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Magnetic"},{"id":"511020952","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia GLOBAL"},{"id":"511023065","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia FINLAND"},{"id":"511025021","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia NORWAY"},{"id":"511025386","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia NETHERLANDS"},{"id":"511093589","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia BULGARIA"},{"id":"511097313","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia FRANCE"},{"id":"511098450","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia MEXICO"},{"id":"511099441","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia SERBIA"},{"id":"511420336","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia FRANCE APLV"},{"id":"511420341","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia FRANCE Laboratoire Gallia"},{"id":"511473748","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia ECUADOR"},{"id":"511477579","billingAgency":"Sprout Performance Partners (Pty) Ltd","advertiser":"Danone Nutricia PHILIPPINES"},{"id":"504912809","billingAgency":"Stan Consulting Group Limited","advertiser":"Stan Consulting Group Limited"},{"id":"508191283","billingAgency":"Striata Communications Solutions (Pty) Ltd","advertiser":"Striata"},{"id":"508019955","billingAgency":"Sun International (south Africa) Limited t/a Sun International Management Limited.","advertiser":"Sun International"},{"id":"508185401","billingAgency":"Supply Chain Junction (Pty) Ltd","advertiser":"SC Junction"},{"id":"503841579","billingAgency":"SynergERP (Pty) Ltd","advertiser":"Synergy ERP"},{"id":"508705120","billingAgency":"SynergERP (Pty) Ltd","advertiser":"Synergy ERP"},{"id":"507917433","billingAgency":"Syspro (Pty) Ltd","advertiser":"Syspro Corporate"},{"id":"509981990","billingAgency":"Tag Brand Studio","advertiser":"Fair Trade Africa"},{"id":"503892936","billingAgency":"Telesure Group Services","advertiser":"Auto & General"},{"id":"503899012","billingAgency":"Telesure Group Services","advertiser":"Budget"},{"id":"507156289","billingAgency":"Telesure Group Services","advertiser":"Telesure Group Services"},{"id":"503785002","billingAgency":"TerraNova Innovations / t/a TerraNova","advertiser":"TerraNova South Africa"},{"id":"504065017","billingAgency":"The Arts Group Limited","advertiser":"BTC (Botswana Telecommunications Corporation)"},{"id":"503635100","billingAgency":"The Standard Bank South Africa Limited","advertiser":"Standard Bank"},{"id":"504964672","billingAgency":"The Standard Bank South Africa Limited","advertiser":"Standard Bank"},{"id":"507092670","billingAgency":"The Standard Bank South Africa Limited","advertiser":"Standard Bank"},{"id":"508759376","billingAgency":"The Standard Bank South Africa Limited","advertiser":"Standard Bank"},{"id":"504973055","billingAgency":"Traffic Brand Digital CC - LI Lite","advertiser":"Pick n Pay"},{"id":"507938199","billingAgency":"Traffic Brand Digital CC - LI Lite","advertiser":"Pick n Pay"},{"id":"508872676","billingAgency":"Turn Left Media (PTY) LTD","advertiser":"Mind Initiatives"},{"id":"503259976","billingAgency":"Turn Left Media Nigeria","advertiser":"Page Financial"},{"id":"503568885","billingAgency":"Turn Left Media Nigeria","advertiser":"Mouka"},{"id":"503583557","billingAgency":"Turn Left Media Nigeria","advertiser":"Glomobile"},{"id":"504047701","billingAgency":"Turn Left Media Nigeria","advertiser":"The Will to Win: The Story of Biodun Shobanjo"},{"id":"504051697","billingAgency":"Turn Left Media Nigeria","advertiser":"Clorets"},{"id":"504944920","billingAgency":"Turn Left Media Nigeria","advertiser":"FCMB"},{"id":"505502855","billingAgency":"Turn Left Media Nigeria","advertiser":"Terragon Group"},{"id":"505554671","billingAgency":"Turn Left Media Nigeria","advertiser":"AfricaWorks"},{"id":"505575641","billingAgency":"Turn Left Media Nigeria","advertiser":"Commercio Partners"},{"id":"505589272","billingAgency":"Turn Left Media Nigeria","advertiser":"MSBM UK"},{"id":"508007850","billingAgency":"Turn Left Media Nigeria","advertiser":"Stanbic"},{"id":"509216569","billingAgency":"Turn Left Media Nigeria","advertiser":"Softcodes International Limited"},{"id":"509559975","billingAgency":"Turn Left Media Nigeria","advertiser":"Verify Me"},{"id":"509586916","billingAgency":"Turn Left Media Nigeria","advertiser":"The Gage Company"},{"id":"510239840","billingAgency":"Turn Left Media Nigeria","advertiser":"Accelerex"},{"id":"510289440","billingAgency":"Turn Left Media Nigeria","advertiser":"Meristem"},{"id":"510601458","billingAgency":"Turn Left Media Nigeria","advertiser":"Ebanqo"},{"id":"509229033","billingAgency":"Tysflo (Pty) Ltd","advertiser":"Selectcast"},{"id":"507960968","billingAgency":"UM, a division of IPG Mediabrands (Pty) Ltd","advertiser":"Sasai Fintech"},{"id":"509218531","billingAgency":"Unisource Software Services (Pty) Ltd","advertiser":"Unisource Software Services (PTY) Ltd"},{"id":"504927567","billingAgency":"Vaal Real Estate t/a Real Estate Developers","advertiser":"Vaal Real Estate Kenya"},{"id":"509977152","billingAgency":"Vacances (Pty) Ltd","advertiser":"Club Med"},{"id":"510288852","billingAgency":"Vacances (Pty) Ltd","advertiser":"Club Med"},{"id":"507186435","billingAgency":"Vans Afslaers Gauteng (Pty) Ltd t/a Vans Auctioneers","advertiser":"Vans Auctioneers"},{"id":"507915154","billingAgency":"VATit Group Limited t/a VAT IT","advertiser":"VATit Group Limited (TecEx)"},{"id":"503790826","billingAgency":"VMLYR (PTY) LTD","advertiser":"PSG"},{"id":"505540427","billingAgency":"Vodacom (PTY) Ltd","advertiser":"Vodacom"},{"id":"507887319","billingAgency":"Vodacom (PTY) Ltd","advertiser":"Vodacom"},{"id":"508821773","billingAgency":"Vodacom (PTY) Ltd","advertiser":"Vodacom"},{"id":"503765984","billingAgency":"Wavemaker (Pty) Ltd","advertiser":"Astron Energy"},{"id":"503830085","billingAgency":"Wavemaker (Pty) Ltd","advertiser":"Huawei"},{"id":"503882546","billingAgency":"Wavemaker (Pty) Ltd","advertiser":"Telkom"},{"id":"503884518","billingAgency":"Wavemaker (Pty) Ltd","advertiser":"Open Serve (part of Telkom Group/BCX)"},{"id":"507946402","billingAgency":"Wavemaker (Pty) Ltd","advertiser":"Tiger Brands"},{"id":"507967585","billingAgency":"Wavemaker (Pty) Ltd","advertiser":"Huawei"},{"id":"504948301","billingAgency":"Wealthbit (Pty) Ltd","advertiser":"Wealthbit (Pty) Ltd"},{"id":"503848005","billingAgency":"Wowzi Technologies Limited","advertiser":"Wowzi Technologies Limited"},{"id":"507968878","billingAgency":"Wunderman Thompson (Pty) Ltd","advertiser":"Sasol"},{"id":"507995139","billingAgency":"YOUKNOW Digital","advertiser":"YouKnow Digital"},{"id":"508147398","billingAgency":"Zapper Marketing (Southern Africa) (Pty) Ltd","advertiser":"Zapper Marketing"},{"id":"504090107","billingAgency":"Zilojo Limited East Wing","advertiser":"Toyota"},{"id":"507871675","billingAgency":"Zilojo Limited East Wing","advertiser":"The Co-operative Bank of Kenya"},{"id":"509025839","billingAgency":"Zilojo Limited East Wing","advertiser":"Loxea Kenya"},{"id":"509051161","billingAgency":"Zilojo Limited East Wing","advertiser":"iPay Africa"},{"id":"509087240","billingAgency":"Zilojo Limited East Wing","advertiser":"CFAO Kenya"},{"id":"509232268","billingAgency":"Zilojo Limited East Wing","advertiser":"Madison Insurance"}];
const BUILTIN_EXCLUDED_IDS = new Set(BUILTIN_EXCLUDED.map(a => a.id));

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toYMD(d)        { return d.toISOString().split('T')[0]; }
function todayStr()      { return toYMD(new Date()); }
function firstOfMonth()  { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 1)); }
function lastMonthStart(){ const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth()-1, 1)); }
function lastMonthEnd()  { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 0)); }

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmtNum(v, dec=2) {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('en-ZA', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v) {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '';
  return (n * 100).toFixed(2) + '%';
}

// ─── Per-row computed values (USD → ZAR, PMF) ────────────────────────────────
function computeRow(r, categoryRates) {
  const catKey  = (r.category || '').trim();
  const catConf = categoryRates?.[catKey] || null;
  const pmf     = catConf?.pmf != null ? catConf.pmf : (r.pmfPercentage || 0);
  const fx      = catConf?.fx  != null ? catConf.fx  : DEFAULT_FX;
  const pmfUSD        = (r.mediaSpendUSD || 0) * pmf;
  const mediaSpendZAR = (r.mediaSpendUSD || 0) * fx;
  const pmfZAR        = pmfUSD * fx;
  return {
    ...r,
    partner:       'LinkedIn',
    itemCode:      `${r.accountId}_${r.campaignGroupId}_ME`,
    pmfPercentage: pmf,
    exchangeRate:  fx,
    pmfUSD,
    mediaSpendZAR,
    pmfZAR,
    grossZAR:      mediaSpendZAR + pmfZAR,
  };
}

// ─── LocalStorage helpers ────────────────────────────────────────────────────
function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function lsSet(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ─── Load SheetJS lazily ──────────────────────────────────────────────────────
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ─── Parse BOD Reference Sheet ───────────────────────────────────────────────
// Sheet: NEW_2023_BOD Reference Shee (2)
// Col mapping (0-indexed):
//   0=Account ID  1=Campaign Group ID  2=IO Number  3=Billing Type (BOD/BOI/BUF)
//   4=Sales Person(StaffCode)  5=Campaign Manager  6=Billing Agency  7=Booking Agency
//   8=Advertiser  9=Industry  10=Managed/Self-Managed  12=PO Number
//   13=Category  15=Platform Man Fee  17=Special Notes
async function parseRefExcel(file) {
  const XLSX = await loadXLSX();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const name = wb.SheetNames.find(n => n.toLowerCase().includes('new_2023')) ||
                     wb.SheetNames.find(n => n.toLowerCase().includes('ref')) ||
                     wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true });

        const byAccGrp = {}, byAcc = {};
        let parsed = 0;

        for (let i = 1; i < rows.length; i++) {
          const r   = rows[i];
          const acc = r[0] ? String(Math.round(Number(r[0]))) : '';
          if (!acc || !/^\d+$/.test(acc)) continue;

          const grp = (r[1] != null && !isNaN(Number(r[1])))
            ? String(Math.round(Number(r[1]))) : '0';

          let pmf = 0;
          if (r[15] != null && r[15] !== '') {
            pmf = parseFloat(r[15]) || 0;
            if (pmf > 1) pmf /= 100;
          }

          const s = v => (v != null && v !== '') ? String(v).trim() : '';

          // billingType  → determines which of the 4 report tabs this row goes to
          // managedType  → further splits BOD into Managed vs Self-Managed
          const billingType = s(r[3]);                                          // BOD / BOI / BUF
          const managedRaw  = s(r[10]);
          const managedType = managedRaw.toLowerCase().includes('self') ? 'Self-Managed'
                            : managedRaw ? 'Managed' : '';

          // reportTab logic
          let reportTab = 'BOD';
          if      (billingType === 'BOI')                               reportTab = 'COD';  // remapped
          else if (billingType === 'BUF')                               reportTab = 'Make Good';  // remapped
          else if (billingType === 'BOD' && managedType === 'Self-Managed') reportTab = 'Self-Managed';
          else if (billingType === 'BOD')                               reportTab = 'BOD';

          const entry = {
            io: s(r[2]), staffCode: s(r[4]), billingAgency: s(r[6]),
            bookingAgency: s(r[7]), advertiser: s(r[8]), industry: s(r[9]),
            poNumber: s(r[12]), category: s(r[13]), pmfPercentage: pmf,
            specialNotes: s(r[17]), billingType, managedType, reportTab,
          };

          const key = `${acc}_${grp}`;
          if (!byAccGrp[key]) byAccGrp[key] = entry;
          if (!byAcc[acc])    byAcc[acc]    = entry;
          parsed++;
        }

        resolve({ byAccGrp, byAcc, sheetName: name, rowCount: parsed });
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── Apply ref sheet to enrich API rows ──────────────────────────────────────
// Match priority: exact acc+group → acc+group=0 → account only
function applyRef(apiRows, ref) {
  if (!ref?.byAccGrp && !ref?.byAcc) return apiRows;
  return apiRows.map(r => {
    const acc = String(r.accountId);
    const grp = String(r.campaignGroupId || '0');
    const d   = ref.byAccGrp?.[`${acc}_${grp}`] ||
                ref.byAccGrp?.[`${acc}_0`]       ||
                ref.byAcc?.[acc]                 || {};
    return {
      ...r,
      io:            d.io            || '',
      staffCode:     d.staffCode     || '',
      billingAgency: d.billingAgency || '',
      bookingAgency: d.bookingAgency || '',
      advertiser:    d.advertiser    || '',
      industry:      d.industry      || '',
      ciNumber:      d.poNumber      || '',
      category:      d.category      || '',
      pmfPercentage: (d.pmfPercentage != null && d.pmfPercentage !== '')
                     ? d.pmfPercentage : 0,
      specialNotes:  d.specialNotes  || '',
      reportTab:     d.reportTab     || 'BOD',
    };
  });
}

// ─── Excel export ─────────────────────────────────────────────────────────────
async function exportToExcel(rows, startDate, endDate, tabName = 'All') {
  const XLSX = await loadXLSX();
  const wsData = [COLS.map(c => c.label)];
  rows.forEach(r => {
    wsData.push(COLS.map(col => {
      const v = r[col.key];
      if (v == null) return '';
      if (col.fmt === 'num2' || col.fmt === 'pct') return typeof v === 'number' ? v : parseFloat(v) || 0;
      return v;
    }));
  });
  const ws  = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = COLS.map(c => ({ wch: Math.round(c.w / 6.5) }));
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = 1; R <= range.e.r; R++) {
    COLS.forEach((col, C) => {
      const a = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[a]) return;
      if (col.fmt === 'num2') ws[a].z = '#,##0.00';
      if (col.fmt === 'pct')  ws[a].z = '0.00%';
    });
  }
  COLS.forEach((col, C) => {
    const a = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[a]) return;
    ws[a].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: col.source === 'blue' ? '00B0F0' : '595959' } },
      alignment: { horizontal: 'center' },
    };
  });
  const month = startDate ? startDate.slice(0, 7).replace('-', '') : 'BOD';
  const wb    = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${month} ${tabName}`);
  XLSX.writeFile(wb, `${month}_${tabName.replace(/ /g, '-')}_${startDate}_${endDate}.xlsx`);
}

// ─── Category Rate mini-form ──────────────────────────────────────────────────
function AddCategoryRow({ existingCategories, rowCategories, onAdd }) {
  const [cat, setCat] = useState('');
  const [pct, setPct] = useState('');
  const [fx,  setFx]  = useState(String(DEFAULT_FX));
  const [open, setOpen] = useState(false);
  const suggestions = rowCategories.filter(c => c && !existingCategories.includes(c) &&
    (!cat || c.toLowerCase().includes(cat.toLowerCase())));
  function commit() {
    const t = cat.trim(); const p = parseFloat(pct); const f = parseFloat(fx);
    if (!t || isNaN(p)) return;
    onAdd(t, p, isNaN(f) ? DEFAULT_FX : f);
    setCat(''); setPct(''); setFx(String(DEFAULT_FX)); setOpen(false);
  }
  return (
    <div className="border-t border-slate-700 pt-2 mt-1 space-y-1.5">
      <p className="text-xs text-slate-500">Add category override:</p>
      <div className="relative">
        <input value={cat} onChange={e => { setCat(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Category name…"
          className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
        {open && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-0.5 bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50 max-h-32 overflow-y-auto">
            {suggestions.slice(0, 8).map(s => (
              <div key={s} onMouseDown={() => { setCat(s); setOpen(false); }}
                className="px-2.5 py-1.5 text-xs text-slate-200 hover:bg-purple-700/60 cursor-pointer truncate">{s}</div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="number" step="0.01" min="0" max="100" value={pct}
          onChange={e => setPct(e.target.value)} onKeyDown={e => e.key === 'Enter' && commit()}
          placeholder="PMF %"
          className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-yellow-300 font-bold placeholder-slate-500 focus:outline-none text-right" />
        <span className="text-xs text-slate-500">%</span>
        <input type="number" step="0.01" min="0" value={fx}
          onChange={e => setFx(e.target.value)} onKeyDown={e => e.key === 'Enter' && commit()}
          placeholder="FX"
          className="flex-1 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-emerald-300 font-bold placeholder-slate-500 focus:outline-none text-right" />
        <button onClick={commit} disabled={!cat.trim() || pct === ''}
          className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ─── Main BODTab Component ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════════
export default function BODTab() {
  const { data: session } = useSession();

  // ── Account list ─────────────────────────────────────────────────────────────
  const [allAccounts,  setAllAccounts]  = useState([]);
  const [loadingAccs,  setLoadingAccs]  = useState(false);
  const [excludedIds,  setExcludedIds]  = useState([]);
  const [showAccMenu,  setShowAccMenu]  = useState(false);

  // ── Ref sheet ────────────────────────────────────────────────────────────────
  const [ref,          setRef]          = useState({ byAccGrp: {}, byAcc: {} });
  const [refCount,     setRefCount]     = useState(0);
  const [refSource,    setRefSource]    = useState('none'); // 'none' | 'uploaded'

  // ── Date inputs — user must press Run to fetch ────────────────────────────
  const [startDate,    setStartDate]    = useState(lastMonthStart);
  const [endDate,      setEndDate]      = useState(lastMonthEnd);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [lastRefresh,  setLastRefresh]  = useState(null);
  const [progress,     setProgress]     = useState({ phase: 0, pct: 0, message: '' });
  const [hasRun,           setHasRun]           = useState(false);
  const [ranDates,         setRanDates]         = useState({ start: '', end: '' }); // dates used in last run
  const datesChanged = hasRun && (ranDates.start !== startDate || ranDates.end !== endDate);

  // ── UI ───────────────────────────────────────────────────────────────────────
  const [search,          setSearch]          = useState('');
  const [activeReportTab, setActiveReportTab] = useState('All Spend');
  const [categoryRates,   setCategoryRates]   = useState(() => lsGet('bod_category_rates', {}));
  const [showCatMenu,     setShowCatMenu]     = useState(false);

  const REPORT_TABS = ['All Spend', 'BOD', 'Self-Managed', 'COD', 'Make Good'];

  const refFileRef = useRef();
  const menuRef    = useRef();
  const catMenuRef = useRef();

  // ── Restore saved ref data on mount ──────────────────────────────────────────
  useEffect(() => {
    const saved = window.__bodRef || lsGet('bod_ref_data_v1', null);
    if (saved?.byAccGrp || saved?.byAcc) {
      window.__bodRef = saved;
      setRef(saved);
      setRefCount(Object.keys(saved.byAccGrp || {}).length);
      setRefSource('uploaded');
    }
    setExcludedIds(lsGet('bod_excluded_ids', []));
  }, []);

  // ── Load account list once session is ready ───────────────────────────────
  useEffect(() => {
    if (!session) return;
    setLoadingAccs(true);
    fetch('/api/accounts')
      .then(r => r.json())
      .then(d => { setAllAccounts(Array.isArray(d) ? d : []); setLoadingAccs(false); })
      .catch(() => setLoadingAccs(false));
  }, [session]);

  // ── Close dropdowns on outside click ────────────────────────────────────────
  useEffect(() => {
    const h = e => {
      if (menuRef.current    && !menuRef.current.contains(e.target))    setShowAccMenu(false);
      if (catMenuRef.current && !catMenuRef.current.contains(e.target)) setShowCatMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Run BOD report ───────────────────────────────────────────────────────────
  // Only runs when user presses the Run button (no auto-fetch on date change).
  // Steps:
  //   1. Take all accounts the user has access to
  //   2. Remove BUILTIN_EXCLUDED (517 from Accounts_to_be_excluded.xlsx) + manual exclusions
  //   3. Phase 1: scan all remaining accounts for spend using costInUsd
  //   4. Phase 2: fetch campaign-group detail for accounts with spend
  //   5. Enrich grey columns from uploaded BOD Ref Sheet
  //   6. Sort rows into 5 tabs
  async function runReport() {
    if (!allAccounts.length) { setError('Account list not loaded yet. Please wait.'); return; }
    setLoading(true); setError(''); setHasRun(true);
    setProgress({ phase: 1, pct: 0, message: 'Starting…' });
    try {
      // Filter accounts: remove exclusion list + manual exclusions
      const accountIdsToFetch = allAccounts
        .filter(a => !BUILTIN_EXCLUDED_IDS.has(String(a.id)) && !excludedIds.includes(String(a.id)))
        .map(a => String(a.id));

      if (!accountIdsToFetch.length) {
        setError('No accounts to fetch after exclusions.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/bod', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accountIds: accountIdsToFetch, startDate, endDate }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Read NDJSON stream
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   apiRows = null;

      const handleLine = line => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          if (msg.error) throw new Error(msg.error);
          if (msg.phase === 1 || msg.phase === 2) {
            setProgress({ phase: msg.phase, pct: msg.pct ?? 0, message: msg.message || '' });
          }
          if (msg.done && Array.isArray(msg.rows)) apiRows = msg.rows;
        } catch (e) {
          if (e.message && !e.message.includes('JSON') && !e.message.includes('Unexpected')) throw e;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        if (done) { lines.forEach(handleLine); break; }
        buffer = lines.pop();
        lines.forEach(handleLine);
      }

      if (!apiRows) throw new Error('No data returned. Check the date range or Vercel logs.');

      // Enrich with ref sheet (fills grey columns + assigns reportTab)
      const activeRef = window.__bodRef || ref;
      const enriched  = applyRef(apiRows, activeRef);

      setRanDates({ start: startDate, end: endDate });
      setRows(enriched);
      setLastRefresh(new Date());
      setProgress({
        phase: 0, pct: 100,
        message: `✓ ${enriched.length} rows · ${[...new Set(enriched.map(r => r.accountId))].length} accounts` +
                 (refCount > 0 ? ` · ref: ${refCount} entries` : ' · no ref sheet'),
      });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  // ── Upload Ref Sheet ──────────────────────────────────────────────────────────
  async function handleRefUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed     = await parseRefExcel(file);
      const entryCount = Object.keys(parsed.byAccGrp || {}).length;
      window.__bodRef  = parsed;
      try { localStorage.setItem('bod_ref_data_v1', JSON.stringify(parsed)); } catch {}
      setRef(parsed);
      setRefCount(entryCount);
      setRefSource('uploaded');
      // Re-enrich existing rows immediately
      if (rows.length > 0) setRows(prev => applyRef(prev, parsed));
      alert(`✅ BOD Ref Sheet loaded\nSheet: "${parsed.sheetName}"\n${parsed.rowCount} rows → ${entryCount} account+group entries`);
    } catch (err) { alert('❌ ' + err.message); }
    e.target.value = '';
  }

  function toggleExclude(id) {
    setExcludedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      lsSet('bod_excluded_ids', next);
      return next;
    });
  }

  // ── Derived rows ──────────────────────────────────────────────────────────────
  const tabCounts = { 'All Spend': 0, BOD: 0, 'Self-Managed': 0, COD: 0, 'Make Good': 0 };
  rows.forEach(r => {
    if (BUILTIN_EXCLUDED_IDS.has(String(r.accountId))) return;
    if (excludedIds.includes(String(r.accountId)))      return;
    tabCounts['All Spend']++;
    const t = r.reportTab || 'BOD';
    if (tabCounts[t] != null) tabCounts[t]++;
  });

  const activeRows = rows.filter(r => {
    if (BUILTIN_EXCLUDED_IDS.has(String(r.accountId))) return false;
    if (excludedIds.includes(String(r.accountId)))      return false;
    if (activeReportTab === 'All Spend') return true;
    return (r.reportTab || 'BOD') === activeReportTab;
  });

  const filteredRows = search
    ? activeRows.filter(r => {
        const s = search.toLowerCase();
        return [r.accountId, r.campaignGroupId, r.campaignGroupName, r.advertiser,
                r.billingAgency, r.io, r.ciNumber, r.category]
          .some(v => v && String(v).toLowerCase().includes(s));
      })
    : activeRows;

  const computedRows = filteredRows.map(r => computeRow(r, categoryRates));

  const totals = computedRows.reduce((t, r) => ({
    mediaSpendUSD: t.mediaSpendUSD + (r.mediaSpendUSD || 0),
    pmfUSD:        t.pmfUSD        + (r.pmfUSD        || 0),
    mediaSpendZAR: t.mediaSpendZAR + (r.mediaSpendZAR || 0),
    pmfZAR:        t.pmfZAR        + (r.pmfZAR        || 0),
    grossZAR:      t.grossZAR      + (r.grossZAR      || 0),
  }), { mediaSpendUSD: 0, pmfUSD: 0, mediaSpendZAR: 0, pmfZAR: 0, grossZAR: 0 });

  const rowCategories = [...new Set(rows.map(r => r.category).filter(Boolean))].sort();
  const activeAccCount = allAccounts.filter(a =>
    !excludedIds.includes(String(a.id)) && !BUILTIN_EXCLUDED_IDS.has(String(a.id))
  ).length;

  // ── Tab colours ───────────────────────────────────────────────────────────────
  const TAB_ACTIVE = {
    'All Spend':    'bg-slate-600 text-white',
    'BOD':          'bg-blue-600 text-white',
    'Self-Managed': 'bg-emerald-600 text-white',
    'COD':          'bg-purple-600 text-white',
    'Make Good':    'bg-amber-600 text-white',
  };

  // ════════════════════════════════════════════════════════════════════════════════
  // ─── RENDER ──────────────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* ══ TOP BAR — date inputs + run button ══ */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center gap-3 flex-wrap shrink-0">

        {/* Date pickers */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">From</span>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
          <span className="text-xs text-slate-400 font-medium">To</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>

        {/* Quick date buttons */}
        {[
          { label: 'This Month', fn: () => { setStartDate(firstOfMonth()); setEndDate(todayStr()); } },
          { label: 'Last Month', fn: () => { setStartDate(lastMonthStart()); setEndDate(lastMonthEnd()); } },
        ].map(q => (
          <button key={q.label} onClick={q.fn}
            className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg border border-slate-600 transition-colors">
            {q.label}
          </button>
        ))}

        {/* ── RUN BUTTON ── */}
        <button onClick={runReport} disabled={loading || loadingAccs}
          className={`flex items-center gap-2 px-4 py-1.5 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors ${
            datesChanged ? 'bg-amber-600 hover:bg-amber-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-500'
          }`}>
          {loading
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : <Play className="w-3.5 h-3.5" />
          }
          {loading ? 'Running…' : datesChanged ? 'Re-run Report' : 'Run Report'}
        </button>

        <div className="flex-1" />

        {/* Ref Sheet upload button */}
        <input type="file" ref={refFileRef} accept=".xlsx,.xls" className="hidden" onChange={handleRefUpload} />
        {refSource === 'none' ? (
          <button onClick={() => refFileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700/70 hover:bg-amber-700 border border-amber-600/60 text-amber-200 rounded-lg text-xs font-semibold transition-colors">
            <Upload className="w-3.5 h-3.5" /> Upload BOD Ref Sheet
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-900/40 border border-emerald-700/60 rounded-lg text-xs text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Ref Sheet · {refCount.toLocaleString()} entries</span>
            </div>
            <button onClick={() => refFileRef.current?.click()} title="Replace ref sheet"
              className="flex items-center gap-1 px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-400 text-xs rounded-lg border border-slate-600">
              <Upload className="w-3 h-3" /> Replace
            </button>
          </div>
        )}

        {/* Account menu */}
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowAccMenu(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 transition-colors">
            {loadingAccs ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{loadingAccs ? 'Loading…' : `${activeAccCount.toLocaleString()} / ${allAccounts.length.toLocaleString()} Accounts`}</span>
            {excludedIds.length > 0 && (
              <span className="bg-red-600 text-white text-xs font-bold rounded-full px-1.5">{excludedIds.length}</span>
            )}
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
          {showAccMenu && (
            <div className="absolute right-0 top-9 z-30 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 p-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
                Accounts ({allAccounts.length.toLocaleString()} total)
              </p>
              <p className="text-xs text-amber-400/80 px-1 mb-2">
                {allAccounts.filter(a => BUILTIN_EXCLUDED_IDS.has(String(a.id))).length} auto-excluded · {excludedIds.length} manually excluded
              </p>
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {allAccounts.map(a => {
                  const excl     = excludedIds.includes(String(a.id));
                  const autoExcl = BUILTIN_EXCLUDED_IDS.has(String(a.id));
                  return (
                    <div key={a.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                        autoExcl ? 'bg-amber-900/20 border border-amber-800/40 cursor-default' :
                        excl     ? 'bg-red-900/30 border border-red-800/50 cursor-pointer' :
                                   'bg-slate-700 hover:bg-slate-600 cursor-pointer'
                      }`}
                      onClick={() => !autoExcl && toggleExclude(String(a.id))}>
                      {autoExcl
                        ? <EyeOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        : excl
                          ? <EyeOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          : <Eye   className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      }
                      <span className={`text-xs flex-1 truncate ${autoExcl ? 'text-amber-400/70 line-through' : excl ? 'text-red-300 line-through' : 'text-white'}`}>{a.name}</span>
                      <span className="text-xs text-slate-500 font-mono shrink-0">{a.id}</span>
                      {autoExcl && <span className="text-xs text-amber-600 shrink-0">auto</span>}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => { setExcludedIds([]); lsSet('bod_excluded_ids', []); }}
                  className="flex-1 py-1.5 bg-slate-600 hover:bg-slate-500 text-slate-200 text-xs rounded-lg">Include All</button>
              </div>
            </div>
          )}
        </div>

        {/* Category Rates */}
        <div className="relative" ref={catMenuRef}>
          <button onClick={() => setShowCatMenu(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              Object.keys(categoryRates).length > 0
                ? 'bg-purple-700 border-purple-600 text-white'
                : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
            <Percent className="w-3.5 h-3.5" />
            PMF Rates
            {Object.keys(categoryRates).length > 0 && (
              <span className="bg-white/20 rounded-full px-1.5 text-xs font-bold">{Object.keys(categoryRates).length}</span>
            )}
          </button>
          {showCatMenu && (
            <div className="absolute right-0 top-9 z-30 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-72 p-3">
              <p className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-purple-400" /> Category PMF Overrides
                <span className="text-slate-500 text-xs font-normal ml-auto">Overrides ref sheet</span>
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto mb-2">
                {Object.keys(categoryRates).length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-3">No overrides set.</p>
                )}
                {Object.entries(categoryRates).map(([cat, conf]) => (
                  <div key={cat} className="bg-slate-700/60 rounded-lg px-2.5 py-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-purple-300 truncate flex-1">{cat}</span>
                      <button onClick={() => { const { [cat]: _, ...rest } = categoryRates; setCategoryRates(rest); lsSet('bod_category_rates', rest); }}
                        className="text-slate-500 hover:text-red-400 ml-2"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-10">PMF %</span>
                      <input type="number" step="0.01" min="0" max="100"
                        value={conf?.pmf != null ? (conf.pmf * 100).toFixed(2) : '0.00'}
                        onChange={e => { const p = parseFloat(e.target.value); const n = { ...categoryRates, [cat]: { ...conf, pmf: isNaN(p) ? 0 : p / 100 } }; setCategoryRates(n); lsSet('bod_category_rates', n); }}
                        className="w-16 bg-slate-600 text-yellow-300 text-xs font-bold rounded px-1.5 py-1 text-right focus:outline-none" />
                      <span className="text-xs text-slate-400">%</span>
                      <span className="text-xs text-slate-400 w-12 ml-2">FX</span>
                      <input type="number" step="0.01" min="0"
                        value={conf?.fx != null ? conf.fx : DEFAULT_FX}
                        onChange={e => { const f = parseFloat(e.target.value); const n = { ...categoryRates, [cat]: { ...conf, fx: isNaN(f) ? DEFAULT_FX : f } }; setCategoryRates(n); lsSet('bod_category_rates', n); }}
                        className="w-16 bg-slate-600 text-emerald-300 text-xs font-bold rounded px-1.5 py-1 text-right focus:outline-none" />
                    </div>
                  </div>
                ))}
              </div>
              <AddCategoryRow
                existingCategories={Object.keys(categoryRates)}
                rowCategories={rowCategories}
                onAdd={(cat, pct, fx) => { const n = { ...categoryRates, [cat]: { pmf: pct / 100, fx } }; setCategoryRates(n); lsSet('bod_category_rates', n); }}
              />
            </div>
          )}
        </div>

        {/* Export */}
        <button disabled={computedRows.length === 0}
          onClick={() => exportToExcel(computedRows, startDate, endDate, activeReportTab)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
        </button>
      </div>

      {/* ══ PROGRESS BAR ══ */}
      {(loading || progress.message) && (
        <div className="bg-slate-800/80 border-b border-slate-700 px-4 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(2, progress.pct)}%` }} />
            </div>
            <span className="text-xs text-slate-400 shrink-0 max-w-md truncate">{progress.message}</span>
          </div>
        </div>
      )}

      {/* ══ TOTALS BAR ══ */}
      {computedRows.length > 0 && (
        <div className="bg-slate-800/50 border-b border-slate-700 px-4 py-1.5 flex items-center gap-4 flex-wrap shrink-0">
          <span className="text-xs text-slate-500">{computedRows.length} rows</span>
          <span className="text-xs"><span className="text-slate-500">Media USD </span><span className="text-white font-bold">${fmtNum(totals.mediaSpendUSD)}</span></span>
          <span className="text-xs"><span className="text-slate-500">PMF USD </span><span className="text-blue-300 font-bold">${fmtNum(totals.pmfUSD)}</span></span>
          <span className="text-xs"><span className="text-slate-500">Media ZAR </span><span className="text-emerald-300 font-bold">R{fmtNum(totals.mediaSpendZAR)}</span></span>
          <span className="text-xs"><span className="text-slate-500">PMF ZAR </span><span className="text-yellow-300 font-bold">R{fmtNum(totals.pmfZAR)}</span></span>
          <span className="text-xs"><span className="text-slate-500">Gross ZAR </span><span className="text-orange-300 font-bold">R{fmtNum(totals.grossZAR)}</span></span>
          {lastRefresh && <span className="text-xs text-slate-600 ml-auto">Updated {lastRefresh.toLocaleTimeString()}</span>}
        </div>
      )}

      {/* ══ REPORT TABS ══ */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-4 py-1.5 flex items-center gap-1.5 shrink-0">
        {REPORT_TABS.map(tab => {
          const count    = tabCounts[tab] || 0;
          const isActive = activeReportTab === tab;
          return (
            <button key={tab} onClick={() => setActiveReportTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                isActive ? TAB_ACTIVE[tab] : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}>
              {tab}
              {count > 0 && (
                <span className={`text-xs rounded-full px-1.5 ${isActive ? 'bg-white/20' : 'bg-slate-700'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="pl-8 pr-7 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1.5 text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 ml-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: BLUE_HDR }} />
            <span className="text-xs text-slate-400">LinkedIn API</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-slate-500" />
            <span className="text-xs text-slate-400">Ref Sheet</span>
          </div>
        </div>
      </div>

      {/* ══ TABLE AREA ══ */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="flex items-center justify-center h-32">
            <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm max-w-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          </div>
        ) : !hasRun ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-slate-500">
            <Play className="w-12 h-12 opacity-20" />
            <div className="text-center">
              <p className="text-sm font-medium text-slate-300 mb-1">Set your date range and press Run Report</p>
              <p className="text-xs">
                {refSource === 'none'
                  ? 'Upload the BOD Ref Sheet first to populate Agency, IO and PMF columns.'
                  : `Ref sheet loaded · ${refCount.toLocaleString()} entries ready`}
              </p>
            </div>
            <button onClick={runReport} disabled={loading || loadingAccs || !allAccounts.length}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors">
              <Play className="w-4 h-4" /> Run Report
            </button>
            {loadingAccs && <p className="text-xs text-slate-500">Loading account list…</p>}
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
            <p className="text-sm">{progress.message || 'Fetching data…'}</p>
          </div>
        ) : computedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
            <FileSpreadsheet className="w-10 h-10 opacity-20" />
            <p className="text-sm">No spend data for this period or tab</p>
            <p className="text-xs">Try a different date range or check another tab</p>
          </div>
        ) : (
          <table className="border-collapse text-xs" style={{ minWidth: 'max-content', width: '100%' }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th key={col.key} style={{
                    minWidth: col.w,
                    background: col.source === 'blue' ? BLUE_HDR : BLACK_HDR,
                    color: '#fff', position: 'sticky', top: 0, zIndex: 10,
                    whiteSpace: 'nowrap', padding: '6px 8px', textAlign: 'left',
                    fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.15)',
                    borderBottom: '2px solid rgba(0,0,0,0.3)', fontSize: 11,
                  }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {computedRows.map((row, i) => {
                const isStripe = i % 2 === 0;
                return (
                  <tr key={`${row.accountId}-${row.campaignGroupId}-${i}`}
                    style={{ background: isStripe ? '#1e293b' : '#172033' }}>
                    {COLS.map(col => {
                      const val     = row[col.key];
                      const isBlack = col.source === 'black';
                      const isEmpty = isBlack && (val == null || val === '' || val === 0);
                      let display = '';
                      if (col.fmt === 'num2') display = val != null ? fmtNum(val, 2) : '';
                      else if (col.fmt === 'pct') display = val != null ? fmtPct(val) : '';
                      else display = val != null ? String(val) : '';

                      return (
                        <td key={col.key} style={{
                          padding: '5px 8px', whiteSpace: 'nowrap',
                          borderRight: '1px solid rgba(255,255,255,0.05)',
                          color: isEmpty ? '#4b5563' : isBlack ? '#cbd5e1' : '#f1f5f9',
                          fontFamily: col.fmt ? 'monospace' : 'inherit',
                          textAlign: col.fmt ? 'right' : 'left',
                          background: isEmpty ? 'rgba(239,68,68,0.04)' : 'transparent',
                        }}>
                          {isEmpty ? '—' : display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr style={{ background: '#0f172a', position: 'sticky', bottom: 0 }}>
                {COLS.map((col, ci) => {
                  const v = TOTAL_KEYS.has(col.key) ? totals[col.key] : null;
                  return (
                    <td key={col.key} style={{
                      padding: '6px 8px', borderRight: '1px solid rgba(255,255,255,0.1)',
                      borderTop: '2px solid rgba(255,255,255,0.15)',
                      fontWeight: 700, fontFamily: 'monospace', textAlign: 'right',
                      color: v != null ? '#fbbf24' : 'transparent',
                      fontSize: 11,
                    }}>
                      {v != null ? (col.fmt === 'pct' ? fmtPct(v) : fmtNum(v, 2)) : ci === 0 ? 'TOTAL' : ''}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}