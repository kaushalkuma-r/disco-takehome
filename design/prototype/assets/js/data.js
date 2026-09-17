/* Campaign Studio prototype — data module.
   PUBS/PERS are the take-home catalog (publishers.json, shopper_personas.json).
   TEMPLATES are hand-written stand-ins for what the real pipeline returns, one per brief family.
   Exposed on window.DCS.data so views/api can read them without a bundler. */
window.DCS = window.DCS || {};
const PUBS = {
 pub_001:{name:"Swiftcart",cat:"instant_delivery",sub:["convenience","groceries","alcohol","household"],imp:84e6,aov:28,age:"18-34",f:.48,geo:"US-East, US-Midwest",inc:"mid",notes:"High-frequency purchasers. Late-night traffic spike. Impulse-friendly."},
 pub_002:{name:"Movewell",cat:"apparel",sub:["activewear","women","men","subscription"],imp:22e6,aov:78,age:"25-44",f:.82,geo:"US-West, US-South",inc:"mid-high",notes:"Fitness-engaged shoppers. Strong crossover with wellness and beauty."},
 pub_003:{name:"Studiogrid",cat:"wellness_services",sub:["fitness_classes","spa","yoga","personal_training"],imp:13.6e6,aov:42,age:"28-50",f:.74,geo:"US-West, US-Northeast",inc:"high",notes:"Appointment-based booking. Users are actively spending on self-care and fitness."},
 pub_004:{name:"Marlowe & Co.",cat:"apparel",sub:["women","mid-life","workwear","casual"],imp:8.4e6,aov:112,age:"45-65",f:.96,geo:"US-South, US-Northeast",inc:"high",notes:"Older affluent women. Lower impulse but high AOV. Responds to quality messaging."},
 pub_005:{name:"Linden Park",cat:"apparel",sub:["women","mid-life","classic","workwear"],imp:6.2e6,aov:128,age:"50-70",f:.98,geo:"US-Northeast, US-South",inc:"high",notes:"Highest-AOV apparel publisher in the catalog. Conservative brand sensibility."},
 pub_006:{name:"Everbody",cat:"apparel",sub:["women","plus_size","workwear","intimates"],imp:7.6e6,aov:89,age:"30-55",f:.99,geo:"US-South, US-Midwest",inc:"mid",notes:"Inclusive sizing across the full range. Audience values representation and fit-focused messaging."},
 pub_007:{name:"Pawline",cat:"pet",sub:["pet_food","pet_supplies","subscription"],imp:4.8e6,aov:64,age:"30-55",f:.62,geo:"US-West, US-South",inc:"mid-high",notes:"Subscription-heavy. Owners are health-conscious about pets, responsive to premium positioning."},
 pub_008:{name:"Pantrygood",cat:"groceries",sub:["organic","natural","subscription","pantry"],imp:10.4e6,aov:86,age:"28-48",f:.71,geo:"US-West, US-Northeast",inc:"high",notes:"Values-driven shoppers. Responsive to clean-ingredient, sustainability, and wellness claims."},
 pub_009:{name:"Ruffco",cat:"pet",sub:["pet_food","pet_supplies","pet_pharmacy"],imp:62e6,aov:73,age:"25-55",f:.64,geo:"nationwide",inc:"mid",notes:"Largest pet audience in the catalog. Broad demographics, repeat-purchase behavior."},
 pub_010:{name:"Heartfoot",cat:"apparel",sub:["socks","underwear","basics","gifting"],imp:5.8e6,aov:52,age:"25-54",f:.58,geo:"nationwide",inc:"mid-high",notes:"Strong gifting season uplift (Nov-Dec). Audience responds to social-good messaging."},
 pub_011:{name:"Northbed",cat:"home",sub:["bedding","bath","home_textiles"],imp:3.6e6,aov:164,age:"28-48",f:.69,geo:"US-Northeast, US-West",inc:"high",notes:"Design-conscious urban/suburban buyers. High cross-sell with home and wellness."},
 pub_012:{name:"Daily Form",cat:"wellness_dtc",sub:["vitamins","supplements","subscription","women"],imp:4.2e6,aov:38,age:"22-42",f:.89,geo:"US-West, US-Northeast",inc:"mid-high",notes:"Science-forward wellness. Audience skeptical of unsubstantiated health claims."},
 pub_013:{name:"Velvetline",cat:"beauty",sub:["skincare","makeup","dtc"],imp:6.8e6,aov:61,age:"18-34",f:.91,geo:"US-West, US-Northeast",inc:"mid",notes:"Gen Z and younger millennial. Minimalist aesthetic, identity-driven purchasing."},
 pub_014:{name:"Hearthstone Goods",cat:"home",sub:["cookware","kitchen","non_toxic"],imp:2.8e6,aov:198,age:"28-48",f:.78,geo:"US-West, US-Northeast",inc:"high",notes:"Sustainability-motivated kitchen buyers. Gifting and new-home life events drive purchase."},
 pub_015:{name:"Kitchenly",cat:"meal_kits",sub:["meal_kits","subscription","groceries"],imp:36e6,aov:74,age:"28-52",f:.67,geo:"nationwide",inc:"mid-high",notes:"Family and couples households. Convenience-motivated but food-interested."},
 pub_016:{name:"Stride & Stem",cat:"apparel",sub:["shoes","women","sustainable"],imp:3.2e6,aov:142,age:"28-48",f:.94,geo:"US-West, US-Northeast",inc:"high",notes:"Professional women. Sustainability and machine-washable claims resonate."},
 pub_017:{name:"Cloudfoot",cat:"apparel",sub:["shoes","activewear","sustainable"],imp:5.8e6,aov:118,age:"25-45",f:.52,geo:"US-West, US-Northeast",inc:"mid-high",notes:"Tech-adjacent urban professionals. Comfort + sustainability messaging."},
 pub_018:{name:"Tailcrate",cat:"pet",sub:["pet_supplies","subscription","toys","treats"],imp:8.4e6,aov:35,age:"25-45",f:.73,geo:"nationwide",inc:"mid",notes:"Millennials treating dogs as family. Fun, playful brand voice converts best."},
 pub_019:{name:"Strandlab",cat:"beauty",sub:["haircare","personalized","dtc"],imp:3.8e6,aov:48,age:"18-38",f:.93,geo:"nationwide",inc:"mid",notes:"Personalization-motivated audience. Quiz-based onboarding elsewhere."},
 pub_020:{name:"Pop & Sip",cat:"beverages",sub:["functional_beverages","soda_alternative","gut_health"],imp:5.2e6,aov:42,age:"22-42",f:.71,geo:"US-West, US-Northeast",inc:"mid-high",notes:"Health-curious but indulgence-seeking. Strong overlap with wellness and premium grocery."}
};
const PERS = {
 persona_001:{name:"The Wellness Optimizer",age:"28-40",g:"female",price:"low",aov:95,likes:["science-backed claims","ingredient transparency","outcome-focused"],dis:["fast_fashion","ultra-processed food","novelty"],desc:"Tracks sleep, supplements, and workouts. Treats her body like a system to optimize."},
 persona_002:{name:"The Busy Parent",age:"32-45",g:"balanced",price:"medium",aov:78,likes:["time-saving","family-friendly","trusted by parents","easy returns"],dis:["luxury positioning","complicated onboarding"],desc:"Dual-income household with kids. Time-poor, loves subscriptions, trusts other parents."},
 persona_003:{name:"The Gen Z Aesthete",age:"19-27",g:"female-leaning",price:"medium-high",aov:48,likes:["aesthetic-forward","values-aligned","novelty","playful"],dis:["corporate voice","performance claims without vibe"],desc:"Highly visual, identity-expressive buyer. Cares about voice, packaging, and what the brand stands for."},
 persona_004:{name:"The Pet Parent",age:"28-50",g:"balanced",price:"low-medium",aov:72,likes:["vet-recommended","ingredient transparency","emotional connection"],dis:["generic pet brands","ultra-cheap positioning"],desc:"Treats their pet as family. Reads ingredient labels. Pays a premium for health and quality."},
 persona_005:{name:"The Affluent Classic",age:"50-68",g:"female",price:"low",aov:145,likes:["craftsmanship","heritage","quality-focused","understated"],dis:["trendy language","loud aesthetics","influencer positioning"],desc:"Disposable income, values quality and longevity over trends. Loyal to brands she trusts."},
 persona_006:{name:"The Sustainability Buyer",age:"25-45",g:"balanced",price:"medium",aov:92,likes:["specific sustainability claims","supply chain transparency","certifications"],dis:["vague eco claims","fast fashion","excessive packaging"],desc:"Buys on environmental and ethical footprint. Researches supply chains. Skeptical of greenwashing."},
 persona_007:{name:"The Convenience-First Millennial",age:"28-38",g:"balanced",price:"medium",aov:55,likes:["speed","one-click","subscription perks"],dis:["multi-step purchases","delayed fulfillment"],desc:"Urban, values speed and frictionlessness. Heavy subscription user, low brand loyalty."},
 persona_008:{name:"The Value-Conscious Shopper",age:"30-55",g:"female-leaning",price:"high",aov:58,likes:["discount-forward","clear value props","bundle offers","reviews"],dis:["luxury-only messaging","vague premium positioning"],desc:"Budget-aware but not low-end. Looks for deals, reads reviews, comparison shops."},
 persona_009:{name:"The Fitness Enthusiast",age:"22-42",g:"balanced",price:"low-medium",aov:88,likes:["performance claims","athlete endorsements","technical fabrics"],dis:["sedentary-lifestyle products","fashion-only positioning"],desc:"Works out 4+ times a week. Brand-loyal to things that perform. Identity-adjacent purchasing."},
 persona_010:{name:"The Gifter",age:"25-60",g:"balanced",price:"low",aov:95,likes:["giftable","premium presentation","last-minute shipping","gift sets"],dis:["subscription-only","self-care-only framing"],desc:"A mode, not a person: anyone within 30 days of a gifting holiday. Wants 'impressive-looking' purchases."}
};

const TEMPLATES = {
 dogfood:{
  name:"Senior dog food · joint health",
  input:"We sell premium dog food for senior dogs, targeting owners who care about joint health and longevity. Grain-free, vet-formulated, subscription-based.",
  clarity:{score:92,label:"Clear",summary:"Premium, vet-formulated, grain-free dog food for senior dogs, sold on subscription. Buyer: health-conscious dog owners who will pay for longevity.",signals:["Product: senior dog food (grain-free, vet-formulated)","Buyer: pet owners focused on joint health","Model: subscription → LTV-oriented bidding","Price tier: premium"]},
  publishers:[
   {id:"pub_007",score:94,bd:{category:98,persona:95,aov:90,audience:92},why:"Pet publisher with a subscription-heavy, health-conscious audience that already responds to premium positioning. Nearly a 1:1 match on product, buyer, and business model."},
   {id:"pub_009",score:88,bd:{category:97,persona:86,aov:84,audience:82},why:"Largest pet audience in the catalog with repeat-purchase behavior and a pharmacy sub-category — strong for a 'vet-formulated' claim. Broader and slightly less premium than Pawline, so it carries the reach budget."},
   {id:"pub_018",score:71,bd:{category:90,persona:78,aov:48,audience:70},why:"Millennial dog-as-family audience is the right emotional fit, but AOV ($35) and a playful brand voice sit below a premium, clinical product. Worth a modest test with a warmer creative."},
   {id:"pub_008",score:58,bd:{category:35,persona:70,aov:82,audience:68},why:"No pet category, but values-driven shoppers who pay for clean ingredients overlap heavily with premium pet-food buyers. Contextual reach, not core."},
   {id:"pub_015",score:46,bd:{category:30,persona:60,aov:70,audience:55},why:"Family households on subscription — the Busy Parent persona lives here. Low category fit; keep as a small, capped experiment."}
  ],
  excluded:[
   {id:"pub_013",why:"Beauty audience, 18–34, identity-driven. No pet affinity and a demographic skew younger than senior-dog owners."},
   {id:"pub_001",why:"Impulse-driven, $28 AOV, late-night convenience. Wrong mode for a considered, premium subscription purchase."},
   {id:"pub_005",why:"Affluent but conservative apparel shoppers 50–70. Income matches; context and category don't — a pet-food ad on a classic-apparel page reads as off-target."},
   {id:"pub_003",why:"Self-care services. Wellness overlap is human, not canine; the product wouldn't be contextually relevant."},
   {id:"pub_020",why:"Functional beverages, 22–42. Health-curious but no pet signal."}
  ],
  personas:[
   {id:"persona_004",fit:97,why:"Reads ingredient labels, pays a premium for pet health, wants vet-recommended. The description could have been written about this persona.",h:"Vet-formulated for the years that matter most.",b:"Grain-free, joint-supporting nutrition built for senior dogs. Every ingredient on the label, nothing hidden. Delivered on the schedule you set.",cta:"See the formula"},
   {id:"persona_002",fit:74,why:"Loves subscriptions and things that remove chores. Pet food is in their affinities; they need to hear 'easy', not 'clinical'.",h:"One less thing to remember.",b:"Senior dog food on subscription — vet-formulated, delivered monthly, pause anytime. Built for families who already have enough on their plate.",cta:"Start a subscription"},
   {id:"persona_001",fit:61,why:"Optimizes her own body with evidence; extends the same lens to her dog. Responds to specific actives and outcome language.",h:"You track your macros. Now track theirs.",b:"Glucosamine, omega-3s and clean protein in every bowl — formulated by vets, backed by joint-health research. Longevity, measured.",cta:"Read the research"},
   {id:"persona_005",fit:52,why:"Older, affluent, quality-over-trend. Likely a long-time dog owner with a senior dog. Wants understated craftsmanship, not hype.",h:"Quality, for a companion who's earned it.",b:"Thoughtfully formulated senior nutrition, made without grain or fillers. Delivered quietly, on your schedule.",cta:"Learn more"}
  ],
  skipped:[{id:"persona_008",why:"Price-sensitive; 'premium' and 'subscription' both work against them."},{id:"persona_003",why:"19–27, beauty/fashion affinities. Low pet-ownership overlap at this age band."}],
  config:{objective:"subscription_signup",kpi:"CPA ≤ $38 (first order); target LTV:CAC 3:1",bid:{strategy:"target_cpa",cpm:"$14–$22",cpc:"$1.10–$1.90",note:"Subscription product → optimize for acquisition cost, not clicks. Start with CPM caps per publisher, switch to tCPA once 50 conversions/publisher."},budget:{daily:400,total:12000,currency:"USD"},targeting:{age:"30–55",gender:"All (skews 62% F)",geos:["US-West","US-South","nationwide"],income:"mid-high, high",interests:["pet_food","pet_health","subscription"],exclude:["ultra-cheap positioning contexts"]},flight:{start:"2026-10-01",end:"2026-10-30"},alloc:[{id:"pub_007",pct:38},{id:"pub_009",pct:34},{id:"pub_018",pct:14},{id:"pub_008",pct:9},{id:"pub_015",pct:5}]}
 },
 activewear:{
  name:"Sustainable women's activewear",
  input:"A sustainable activewear brand for women. Made from recycled ocean plastic. Price point sits between Lululemon and Girlfriend Collective.",
  clarity:{score:86,label:"Clear",summary:"Women's activewear made from recycled ocean plastic, priced mid-premium (~$70–$120). Buyer: women who work out and care about materials.",signals:["Product: women's activewear","Differentiator: recycled ocean plastic (specific, verifiable)","Price tier: mid-premium — anchored to Lululemon / Girlfriend Collective","Buyer: fitness + sustainability"]},
  publishers:[
   {id:"pub_002",score:95,bd:{category:99,persona:94,aov:92,audience:96},why:"Women's activewear publisher, 82% female, 25–44, mid-high income, with wellness crossover. The audience is literally shopping this category."},
   {id:"pub_017",score:82,bd:{category:85,persona:84,aov:80,audience:78},why:"Sustainable activewear/shoes with a comfort + sustainability message. More gender-balanced (52% F), so cap spend and use women-led creative."},
   {id:"pub_016",score:79,bd:{category:70,persona:88,aov:86,audience:80},why:"Professional women buying sustainable shoes; AOV $142 proves they pay for materials. Category-adjacent, persona-perfect."},
   {id:"pub_003",score:68,bd:{category:55,persona:80,aov:60,audience:78},why:"People booking yoga and fitness classes are moments away from needing kit. Contextual, high-intent placement at booking confirmation."},
   {id:"pub_008",score:44,bd:{category:20,persona:66,aov:64,audience:60},why:"No apparel, but values-driven organic shoppers overlap with the Sustainability Buyer. Small reach test."}
  ],
  excluded:[
   {id:"pub_009",why:"Pet audience. No apparel or fitness signal."},
   {id:"pub_001",why:"$28 AOV impulse buys. A $90 legging is a considered purchase."},
   {id:"pub_005",why:"50–70, conservative classic apparel. Wrong age band and aesthetic."},
   {id:"pub_018",why:"Pet supplies, playful millennial dog owners."},
   {id:"pub_015",why:"Meal kits. Some persona overlap (Busy Parent) but no product context."}
  ],
  personas:[
   {id:"persona_006",fit:96,why:"'Recycled ocean plastic' is exactly the specific, verifiable claim they demand. Skeptical of vague eco-talk, so the copy must name the material.",h:"Leggings made from 12 ocean-bound bottles. Exactly 12.",b:"Traceable recycled polyester, GRS-certified, sewn in a Fair Trade facility. We publish the supply chain so you don't have to take our word for it.",cta:"Trace the fabric"},
   {id:"persona_009",fit:84,why:"Trains 4+ times a week and only stays loyal to gear that performs. Sustainability is a bonus; performance claims come first.",h:"Squat-proof. Sweat-wicking. Ocean-sourced.",b:"Four-way stretch that holds through a 90-minute session and 200 washes. Built for the workout first — the planet gets the assist.",cta:"Shop performance"},
   {id:"persona_001",fit:71,why:"Optimizer mindset: wants fabric specs, not vibes. Responds to numbers and outcomes.",h:"Engineered for the sessions you track.",b:"Compression-mapped panels, 4-way stretch, moisture-wicking recycled fibers. Designed with movement data, not mood boards.",cta:"See the specs"},
   {id:"persona_003",fit:66,why:"Identity-expressive and values-aligned. Wants a brand that stands for something and looks good doing it. Keep it playful, never corporate.",h:"Wear the ocean. Save the ocean.",b:"Colour-drenched sets made from bottles pulled off beaches. Looks like a statement because it is one.",cta:"Shop the drop"}
  ],
  skipped:[{id:"persona_005",why:"50–68, classic apparel — activewear is not their category."},{id:"persona_004",why:"Pet-focused affinities, no apparel signal."}],
  config:{objective:"purchase",kpi:"ROAS ≥ 3.0; CPA ≤ $30",bid:{strategy:"max_conversions_with_cpa_cap",cpm:"$16–$26",cpc:"$0.90–$1.60",note:"Apparel converts on first visit less often; use view-through attribution (7d) and retarget on Movewell."},budget:{daily:600,total:18000,currency:"USD"},targeting:{age:"25–45",gender:"Women",geos:["US-West","US-Northeast","US-South"],income:"mid-high, high",interests:["activewear","sustainable_apparel","fitness_services"],exclude:["fast-fashion contexts"]},flight:{start:"2026-10-01",end:"2026-10-30"},alloc:[{id:"pub_002",pct:42},{id:"pub_017",pct:22},{id:"pub_016",pct:18},{id:"pub_003",pct:12},{id:"pub_008",pct:6}]}
 },
 wellness:{
  name:"Meditation & sleep app",
  input:"We help people feel better.",
  clarity:{score:24,label:"Vague",summary:"Too little signal to match publishers safely. Three questions resolve the ambiguity.",signals:["No product type","No buyer","No price tier"],
   questions:[
    {q:"What are you actually selling?",opts:["An app or digital service","A physical product","Supplements or food","A service with humans (coaching, clinics)"]},
    {q:"Who is it mostly for?",opts:["Stressed professionals","Parents","Athletes / fitness people","Older adults"]},
    {q:"What does it cost?",opts:["Free with paid tier","~$10–20 / month","$50–150 one-time","$150+"]}
   ],
   resolved:"Interpreted as: a meditation & sleep app on a ~$12/month subscription, for stressed professionals aged 25–45."},
  publishers:[
   {id:"pub_003",score:89,bd:{category:92,persona:88,aov:80,audience:94},why:"Users booking yoga, spa and fitness sessions are actively spending on self-care. High-income 28–50 — the exact stressed-professional profile. Post-booking placement is a natural 'keep the calm going' moment."},
   {id:"pub_012",score:81,bd:{category:78,persona:86,aov:74,audience:84},why:"Science-forward wellness subscribers who already pay monthly. They are skeptical of fluffy claims, so creative must cite sleep outcomes, not vibes."},
   {id:"pub_020",score:63,bd:{category:55,persona:70,aov:60,audience:72},why:"Health-curious, indulgence-seeking 22–42s. 'Wind-down' beverage buyers are a good moment for a sleep pitch."},
   {id:"pub_002",score:60,bd:{category:50,persona:72,aov:62,audience:66},why:"Fitness-engaged women with wellness crossover. Recovery framing ('rest is training') fits."},
   {id:"pub_011",score:55,bd:{category:48,persona:64,aov:50,audience:64},why:"People buying bedding are thinking about sleep. Small, contextual test on the order-confirmation page."}
  ],
  excluded:[
   {id:"pub_009",why:"Pet audience. No signal."},
   {id:"pub_001",why:"Late-night impulse grocery. Ironically a sleep-deprived audience, but wrong intent and $28 AOV."},
   {id:"pub_005",why:"50–70 conservative apparel. Older than the stated buyer."},
   {id:"pub_018",why:"Pet supplies."},
   {id:"pub_014",why:"Cookware buyers in a life-event moment. Weak link to a digital wellness product."}
  ],
  personas:[
   {id:"persona_001",fit:93,why:"Already tracks sleep. Wants to see the mechanism and the numbers.",h:"Fall asleep 14 minutes faster. On average, in 3 weeks.",b:"Guided wind-downs built on CBT-i research, with a sleep score that syncs to your tracker. Try it free for 14 days — bring your data.",cta:"Start free"},
   {id:"persona_007",fit:78,why:"Wants zero friction and a subscription that just runs. One tap, no onboarding maze.",h:"Two taps to calm. No account required to start.",b:"Open, press play, breathe. Pause or cancel anytime — it's a subscription that behaves.",cta:"Try one session"},
   {id:"persona_002",fit:70,why:"Time-poor, stretched thin. Needs the pitch to be about minutes, not lifestyle.",h:"Ten quiet minutes that are actually yours.",b:"Short sessions that fit between bedtime stories and the dishwasher. Recommended by parents who also never have time.",cta:"Find ten minutes"},
   {id:"persona_009",fit:58,why:"Recovery is part of training. Frame rest as performance.",h:"Recovery is a rep too.",b:"Sleep and breathwork programs designed with sports physios. Better sleep, faster recovery, measurable in your next session.",cta:"See recovery plans"}
  ],
  skipped:[{id:"persona_005",why:"App-first product; audience skews older than the stated buyer."},{id:"persona_010",why:"Subscription-only offers gift poorly."}],
  config:{objective:"trial_start",kpi:"Cost per trial ≤ $9; trial→paid ≥ 30%",bid:{strategy:"target_cpa",cpm:"$10–$18",cpc:"$0.60–$1.20",note:"Low-ticket subscription → volume matters. Bid on trial starts, then retarget non-converters with the outcome creative."},budget:{daily:250,total:7500,currency:"USD"},targeting:{age:"25–45",gender:"All (skews F)",geos:["US-West","US-Northeast"],income:"mid-high, high",interests:["wellness","fitness_services","supplements","sleep"],exclude:["late-night impulse contexts"]},flight:{start:"2026-10-01",end:"2026-10-30"},alloc:[{id:"pub_003",pct:36},{id:"pub_012",pct:28},{id:"pub_020",pct:14},{id:"pub_002",pct:12},{id:"pub_011",pct:10}]}
 }
};

const EXAMPLES=[
 "We sell premium dog food for senior dogs, targeting owners who care about joint health and longevity. Grain-free, vet-formulated, subscription-based.",
 "A sustainable activewear brand for women. Made from recycled ocean plastic. Price point sits between Lululemon and Girlfriend Collective.",
 "We help people feel better.",
 "idk just try it"
];

const ALT={
 persona_004:[["Senior years, stronger joints.","Formulated with vets for dogs 7+. Glucosamine and omega-3s in every serving, delivered before you run out.","Build a plan"]],
 persona_002:[["Their dinner, handled.","Auto-delivered senior dog food that's vet-formulated and grain-free. Skip a month in one tap.","Set it up"]],
 persona_001:[["Joint health you can measure.","Clinically dosed glucosamine, chondroitin and EPA/DHA. Full ingredient panel published — compare it to what you feed now.","Compare formulas"]],
 persona_006:[["Certified recycled. Traceable to the beach.","Every pair lists its bottle count and the collection site. GRS-certified, plastic-free packaging.","See the trace"]],
 persona_009:[["Built for the tenth set, not the selfie.","Compression that stays put through burpees and 200 washes. Made from ocean plastic — but you'll buy it for the fit.","Shop the fit"]],
 persona_007:[["Press play. That's the onboarding.","No quiz, no ten-screen setup. Sessions start in one tap and your subscription pauses in one more.","Try it now"]]
};

window.DCS.data = { PUBS, PERS, TEMPLATES, EXAMPLES, ALT };
