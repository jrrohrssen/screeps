require("populations");

let Roles = require("roles");
let Hive = require("hive");

let _CPU = require("util.cpu");

let labDefinitions;

module.exports = {

	Run: function(rmColony) {
		_CPU.Start(rmColony, "Industry-init");
		labDefinitions = _.get(Memory, ["rooms", rmColony, "labs", "definitions"]);
		listSpawnRooms = _.get(Memory, ["rooms", rmColony, "spawn_assist", "rooms"]);		
		popTarget = _.get(Memory, ["rooms", rmColony, "custom_population"]);		
		_CPU.End(rmColony, "Industry-init");

		_CPU.Start(rmColony, "Industry-listCreeps");
		let listCreeps = _.filter(Game.creeps, c => c.memory.room == rmColony);
		_CPU.End(rmColony, "Industry-listCreeps");

		if (isPulse_Spawn()) {
			_CPU.Start(rmColony, "Industry-runPopulation");
			this.runPopulation(rmColony, listCreeps, listSpawnRooms, popTarget);
			_CPU.End(rmColony, "Industry-runPopulation");
		}

		_CPU.Start(rmColony, "Industry-defineLabs");
		if (isPulse_Lab()) {
			this.defineLabs(rmColony);
		}
		_CPU.End(rmColony, "Industry-defineLabs");

		_CPU.Start(rmColony, "Industry-runLabs");
		this.runLabs(rmColony);
		_CPU.End(rmColony, "Industry-runLabs");

		if (isPulse_Mid()) {
			// Reset task list for recompilation
			_.set(Memory, ["rooms", rmColony, "industry", "tasks"], new Array());
			_.set(Memory, ["rooms", rmColony, "industry", "boosts"], new Array());

			_CPU.Start(rmColony, "Industry-loadNukers");
			this.loadNukers(rmColony);
			_CPU.End(rmColony, "Industry-loadNukers");

			_CPU.Start(rmColony, "Industry-createLabTasks");
			_.set(Memory, ["rooms", rmColony, "industry", "tasks", "list"], new Object());
			_.set(Memory, ["rooms", rmColony, "industry", "tasks", "running"], new Object());
			this.createLabTasks(rmColony);
			_CPU.End(rmColony, "Industry-createLabTasks");

			_CPU.Start(rmColony, "Industry-runTerminal");
			this.runTerminal(rmColony);
			_CPU.End(rmColony, "Industry-runTerminal");
		}

		_CPU.Start(rmColony, "Industry-runCreeps");
		this.runCreeps(rmColony, listCreeps);
		_CPU.End(rmColony, "Industry-runCreeps");
	},


	runPopulation: function(rmColony, listCreeps, listSpawnRooms, populationTarget) {
		let popActual = new Object();
		_.set(popActual, "courier", _.filter(listCreeps, (c) => c.memory.role == "courier" && (c.ticksToLive == undefined || c.ticksToLive > 80)).length);

		if (popTarget == null)
			popTarget = _.cloneDeep(Population_Industry);
		else
			popTarget = _.cloneDeep(populationTarget)

		// Tally population levels for level scaling and statistics
		Hive.populationTally(rmColony, 
			_.sum(popTarget, p => { return _.get(p, "amount", 0); }), 
			_.sum(popActual));

		if (_.get(Game, ["rooms", rmColony, "terminal"])
			&& _.get(popActual, "courier", 0) < _.get(popTarget, ["courier", "amount"], 0)) {
			Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, 
				priority:  Math.lerpSpawnPriority(14, 16, _.get(popActual, "courier"), _.get(popTarget, ["courier", "amount"])),
				level: popTarget["courier"]["level"],
				scale: popTarget["courier"] == null ? true : popTarget["courier"]["scale"],
				body: "courier", name: null, args: {role: "courier", room: rmColony} });
        }
	},

	loadNukers: function(rmColony) {
		let nuker = _.head(Game.rooms[rmColony].find(FIND_STRUCTURES, { filter: (s) => { return s.structureType == "nuker"; } }));
		let storage = Game.rooms[rmColony].storage;

		if (nuker == null || storage == null)
			return;

		if (nuker.energy < nuker.energyCapacity && _.get(storage, ["store", "energy"], 0) > 0) {
			Memory.rooms[rmColony].industry.tasks.push(
				{ type: "withdraw", resource: "energy", id: storage.id, timer: 60, priority: 5 },
				{ type: "deposit", resource: "energy", id: nuker.id, timer: 60, priority: 5 });
		}

		if (nuker.ghodium < nuker.ghodiumCapacity) {
			if (_.get(Memory, ["rooms", rmColony, "stockpile", "G"]) == null)
				_.set(Memory, ["rooms", rmColony, "stockpile", "G"], 500)

			if (_.get(storage, ["store", "G"], 0) > 0) {
				Memory.rooms[rmColony].industry.tasks.push(
					{ type: "withdraw", resource: "G", id: storage.id, timer: 60, priority: 5 },
					{ type: "deposit", resource: "G", id: nuker.id, timer: 60, priority: 5 });
			}
		}
	},

	assignReaction: function(rmColony) {		
		if (_.filter(Game["rooms"][rmColony].find(FIND_MY_STRUCTURES), s => { return s.structureType == "lab" 
			&& _.filter(labDefinitions, def => { return _.get(def, "action") == "boost" && _.get(def, "lab") == s.id; }).length == 0 }).length < 3) {
			console.log(`<font color=\"#A17BFF\">[Labs]</font> Unable to assign a reaction to ${rmColony}- not enough labs available for reactions (labs boosting?).`);
			return;
		}

		let target = _.head(_.sortBy(_.sortBy(_.sortBy(_.filter(_.get(Memory, ["resources", "labs", "targets"]),
			t => {
				let amount = 0, r1_amount = 0, r2_amount = 0;
				let reagents = getReagents(_.get(t, "mineral"));
				_.each(_.filter(Game.rooms,
					r => { return r.controller != null && r.controller.my && r.terminal; }),
					r => {
						amount += r.store(_.get(t, "mineral"));
						r1_amount += r.store(reagents[0]);
						r2_amount += r.store(reagents[1]);
					});
				return (_.get(t, "amount") < 0 || amount < _.get(t, "amount")) && r1_amount >= 1000 && r2_amount >= 1000;
			}),
			t => _.get(t, "priority")),
			t => _.get(t, "is_reagent")),
			t => _.filter(_.get(Memory, ["resources", "labs", "reactions"]), r => { return _.get(r, "mineral") == _.get(t, "mineral"); }).length));

		if (target != null) {
			_.set(Memory, ["resources", "labs", "reactions", rmColony], { mineral: target.mineral, amount: target.amount });
			console.log(`<font color=\"#A17BFF\">[Labs]</font> Assigning ${rmColony} to create ${target.mineral}.`);
		} else {
			_.set(Memory, ["resources", "labs", "reactions", rmColony], { mineral: null, amount: null });
			console.log(`<font color=\"#A17BFF\">[Labs]</font> No reaction to assign to ${rmColony}, idling.`);
		}

	},

	defineLabs: function(rmColony) {
		// Clean up labDefinitions, remove duplicate "boosts", remove "empty" if already empty
		if (labDefinitions != null) {
			for (let i = labDefinitions.length - 1; i >= 0; i--) {
				if (_.get(labDefinitions[i], "action") == "boost") {
					if (_.get(labDefinitions[i], "expire") != null && _.get(labDefinitions[i], "expire") < Game.time)					
						labDefinitions.splice(i, 1);

					for (let j = labDefinitions.length - 1; j >= 0; j--) {
						if (i != j && _.get(labDefinitions[i], "lab") == _.get(labDefinitions[j], "lab"))
							labDefinitions.splice(i, 1);
					}
				} else if (_.get(labDefinitions[i], "action") == "empty") {
					let labs = _.get(labDefinitions[i], "labs");
					for (let j = labs.length - 1; j >= 0; j--) {
						let lab = Game.getObjectById(labs[j]);
						if (lab == null || lab.mineralAmount == 0)
							labs.splice(j, 1);
					}

					if (labs.length == 0)
						labDefinitions.splice(i, 1)
					else
						_.set(labDefinitions[i], "labs", labs);
				}
			}
			_.set(Memory, ["rooms", rmColony, "labs", "definitions"], labDefinitions);
		}	

		// Get labs able to process reactions (exclude labs defined to boost)
		let labs = _.filter(Game["rooms"][rmColony].find(FIND_MY_STRUCTURES), s => { return s.structureType == "lab" 
			&& _.filter(labDefinitions, def => { return _.get(def, "action") == "boost" && _.get(def, "lab") == s.id; }).length == 0 });
		
		// Not enough labs to support a reaction? Remove defined reactions, empty labs (if needed) and return
		if (labDefinitions != null && labs.length < 3) {			
			for (let i = labDefinitions.length - 1; i >= 0; i--) {
				if (_.get(labDefinitions, [i, "action"]) == "reaction")
					labDefinitions.splice(i, 1)
			}

			for (let i = 0; i < labs.length; i++) {
				if (labs[i].mineralAmount > 0 && _.filter(labDefinitions, d => { return _.get(d, "action") == "empty" 
						&& _.filter(_.get(d, "labs"), l => { return l == labs[i].id;}).length > 0 }).length == 0) {

					labDefinitions.push({ action: "empty", labs: [labs[i].id] });
				}			
			}

			_.set(Memory, ["rooms", rmColony, "labs", "definitions"], labDefinitions);
			return;
		}

		let terminal = _.get(Game, ["rooms", rmColony, "terminal"]);
		if (terminal == null)
			terminal = _.head(labs);

		labs = _.sortBy(labs, lab => { return lab.pos.getRangeTo(terminal.pos.x, terminal.pos.y); });
		let supply1 = _.get(labs, [0, "id"]);
		let supply2 = _.get(labs, [1, "id"]);
		let reactors = [];
		for (let i = 2; i < labs.length; i++)
			reactors.push(_.get(labs, [i, "id"]));

		// Clear existing "reaction" actions before adding new ones
		if (labDefinitions == null) 
			labDefinitions = [];
		else {
			for (let i = labDefinitions.length - 1; i >= 0; i--) {
				if (_.get(labDefinitions, [i, "action"]) == "reaction")
					labDefinitions.splice(i, 1)
			}
		} 

		labDefinitions.push({ action: "reaction", supply1: supply1, supply2: supply2, reactors: reactors });
		_.set(Memory, ["rooms", rmColony, "labs", "definitions"], labDefinitions);
		console.log(`<font color=\"#A17BFF\">[Labs]</font> Labs defined for ${rmColony}.`);
	},

	runLabs: function(rmColony) {
		/* Arguments for labDefinitions:

			Memory["rooms"][rmColony]["labs"]["definitions"]

			[ { action: "reaction", supply1: "5827cdeb16de9e4869377e4a", supply2: "5827f4b3a0ed8e9f6bf5ae3c",
				reactors: [ "5827988a4f975a7d696dba90", "5828280b74d604b04955e2f6", "58283338cc371cf674426315", "5827fcc4d448f67249f48185",
					"582825566948cb7d61593ab9", "58271f0e740746b259c029e9", "5827e49f0177f1ea2582a419" ] } ]);

			{ action: "boost", mineral: "", lab: "", role: "", subrole: "" }
			{ action: "reaction", amount: -1, mineral: "",
			  supply1: "", supply2: "",
			  reactors: ["", "", ...] }
			{ action: "empty", labs: ["", "", ...] }
		*/

		if (isPulse_Lab()) {
			this.assignReaction(rmColony);
		}

        for (let l in labDefinitions) {
            let listing = labDefinitions[l];
             switch (listing["action"]) {
                default:
                    break;

				case "boost":
					let lab = Game.getObjectById(listing["lab"]);
					
					if (lab == null || (_.get(listing, "expire") != null && _.get(listing, "expire") < Game.time))
						break;

					let creeps = lab.pos.findInRange(FIND_MY_CREEPS, 1, { filter: (c) => { 
						return c.memory.role == listing["role"]
							&& c.memory.subrole == listing["subrole"]
							&& c.ticksToLive > 1100 && !c.isBoosted() }});

					if (creeps.length > 0) {
						lab.boostCreep(creeps[0]);
					}

					break;

                case "reaction":
                    let labSupply1 = Game.getObjectById(listing["supply1"]);
                    let labSupply2 = Game.getObjectById(listing["supply2"]);

					if (labSupply1 == null && labSupply2 == null)
						break;

					let mineral = _.get(Memory, ["resources", "labs", "reactions", rmColony, "mineral"]);
					if (mineral == null)
						return;
					
					if (_.get(REACTIONS, [labSupply1.mineralType, labSupply2.mineralType]) != mineral)
						return;

					let amount = _.get(Memory, ["resources", "labs", "reactions", rmColony, "amount"], -1);
					if (amount > 0 && Game.rooms[rmColony].store(mineral) >= amount) {
						if (_.get(Memory, ["resources", "labs", "targets", mineral, "is_reagent"]))
							delete Memory["resources"]["labs"]["targets"][mineral];
						delete Memory["resources"]["labs"]["reactions"][rmColony];
						console.log(`<font color=\"#A17BFF\">[Labs]</font> ${rmColony} completed target for ${mineral}, re-assigning lab.`);
						delete Memory["hive"]["pulses"]["lab"];	
						return;
					}

					_.forEach(listing["reactors"], r => {
						let labReactor = Game.getObjectById(r);
						if (labReactor != null)
							labReactor.runReaction(labSupply1, labSupply2);
					});

                    break;
             }
        }
	},

	createLabTasks: function(rmColony) {
		/* Terminal task priorities:
		 * 2: emptying labs
		 * 3: filling labs
		 * 4: filling nuker
		 * 5: filling orders
		 * 6: emptying terminal
		 */

		for (let l in labDefinitions) {
			var lab, storage;
			let listing = labDefinitions[l];

			switch (listing["action"]) {
				default:
					break;

				case "boost":
					lab = Game.getObjectById(listing["lab"]);
					if (lab == null)
						break;

					if (_.get(Memory, ["rooms", rmColony, "stockpile", listing["mineral"]]) == null)
						_.set(Memory, ["rooms", rmColony, "stockpile", listing["mineral"]], 1000)

					// Minimum amount necessary to boost 1x body part: 30 mineral & 20 energy
					if (lab.mineralType == listing["mineral"] && lab.mineralAmount > 30 && lab.energy > 20) {
						Memory.rooms[rmColony].industry.boosts.push(
							{ role: listing["role"], subrole: listing["subrole"], resource: listing["mineral"], id: lab.id, timer: 60 });
					}

					storage = Game.rooms[rmColony].storage;
					if (storage == null) break;

					if (lab.mineralType != null && lab.mineralType != listing["mineral"]) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: lab.mineralType, id: lab.id, timer: 60, priority: 2 });
					} else if (lab.energy < lab.energyCapacity * 0.75 && storage.store["energy"] > 0) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: "energy", id: storage.id, timer: 60, priority: 3 },
							{ type: "deposit", resource: "energy", id: lab.id, timer: 60, priority: 3 });
					} else if (lab.mineralAmount < lab.mineralCapacity * 0.75 && Object.keys(storage.store).includes(listing["mineral"])) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: listing["mineral"], id: storage.id, timer: 60, priority: 3 },
							{ type: "deposit", resource: listing["mineral"], id: lab.id, timer: 60, priority: 3 });
					}
					break;

				case "empty":
				    storage = Game.rooms[rmColony].storage;
				    if (storage == null) break;
					_.forEach(listing["labs"], l => {
						lab = Game.getObjectById(l);
						if (lab.mineralAmount > 0) {
							Memory.rooms[rmColony].industry.tasks.push(
								{ type: "withdraw", resource: lab.mineralType, id: lab.id, timer: 60, priority: 2 });
						}
					});
					break;

				case "reaction":
					storage = Game.rooms[rmColony].storage;
					if (storage == null) break;

					let mineral = _.get(Memory, ["resources", "labs", "reactions", rmColony, "mineral"]);
					if (mineral == null)
						return;

					let reagents = getReagents(mineral);
					let supply1_mineral = reagents[0];
					let supply2_mineral = reagents[1];
					_.set(Memory, ["rooms", rmColony, "stockpile", supply1_mineral], 1000)
					_.set(Memory, ["rooms", rmColony, "stockpile", supply2_mineral], 1000)


					lab = Game.getObjectById(listing["supply1"]);
					if (lab == null) {
						console.log(`<font color=\"#FF0000\">[Error]</font> Sites.Industry: Game.getObjectById(${listing["supply1"]}) is null.`);
						return;
					}
					else if (lab.mineralType != null && lab.mineralType != supply1_mineral) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: lab.mineralType, id: lab.id, timer: 60, priority: 2 });
					}
					else if (Object.keys(storage.store).includes(supply1_mineral)
							&& lab.mineralAmount < lab.mineralCapacity * 0.25) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: supply1_mineral, id: storage.id, timer: 60, priority: 3 },
							{ type: "deposit", resource: supply1_mineral, id: lab.id, timer: 60, priority: 3 });
					}

					lab = Game.getObjectById(listing["supply2"]);
					if (lab == null) {
						console.log(`<font color=\"#FF0000\">[Error]</font> Sites.Industry: Game.getObjectById(${listing["supply2"]}) is null.`);
						return;
					}
					else if (lab.mineralType != null && lab.mineralType != supply2_mineral) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: lab.mineralType, id: lab.id, timer: 60, priority: 2 });
					}
					else if (Object.keys(storage.store).includes(supply2_mineral)
							&& lab.mineralAmount < lab.mineralCapacity * 0.25) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: supply2_mineral, id: storage.id, timer: 60, priority: 3 },
							{ type: "deposit", resource: supply2_mineral, id: lab.id, timer: 60, priority: 3 });
					}

					_.forEach(listing["reactors"], r => {
						lab = Game.getObjectById(r);
							if (lab == null) {
							console.log(`<font color=\"#FF0000\">[Error]</font> Sites.Industry: Game.getObjectById(${r}) is null.`);
							return;
						}
						else if (lab.mineralType != null && lab.mineralType != mineral) {
							Memory.rooms[rmColony].industry.tasks.push(
								{ type: "withdraw", resource: lab.mineralType, id: lab.id, timer: 60, priority: 2 });
						} else if (lab.mineralAmount > lab.mineralCapacity * 0.2) {
							Memory.rooms[rmColony].industry.tasks.push(
								{ type: "withdraw", resource: mineral, id: lab.id, timer: 60, priority: 2 });
						}
					});

					break;
			}
		}
	},

	runTerminal: function (rmColony) {
		if (Game.rooms[rmColony].terminal != null && Game.rooms[rmColony].terminal.my) {

			if (_.get(Memory, ["resources", "terminal_orders"]) == null)
				_.set(Memory, ["resources", "terminal_orders"], new Object());
			if (_.get(Memory, ["rooms", rmColony, "stockpile"]) == null)
				_.set(Memory, ["rooms", rmColony, "stockpile"], new Object());

			let shortage = {};
			let room = Game.rooms[rmColony];
			let storage = Game.rooms[rmColony].storage;
			let terminal = Game.rooms[rmColony].terminal;
			let energy_level = room.store("energy");
			let energy_critical = room.getCriticalEnergy();

			// Create orders to request resources to meet per-room stockpile
			for (let res in _.get(Memory, ["rooms", rmColony, "stockpile"])) {
				shortage[res] = _.get(Memory, ["rooms", rmColony, "stockpile", res]) - room.store(res);

				if (shortage[res] > 0)
					_.set(Memory, ["resources", "terminal_orders", `${rmColony}-${res}`], 
						{ room: rmColony, resource: res, amount: shortage[res], automated: true, priority: 2 });
			}

			// Set critical energy threshold to room's stockpile (to prevent sending to other rooms)
			if (_.get(Memory, ["rooms", rmColony, "stockpile", "energy"], 0) < energy_critical)			
				_.set(Memory, ["rooms", rmColony, "stockpile", "energy"], energy_critical);

			// Create high priority order to fix critical shortage of energy in this room (include margins for error)
			if (energy_level < energy_critical) {
				let amount = Math.max((energy_critical * 1.25) - energy_level, 1000);

				if (amount > 0) {
					// Prevent spamming "new energy order creted" if it's just modifying the amount on an existing order...
					if (_.get(Memory, ["resources", "terminal_orders", `${rmColony}-energy_critical`]) == null)
						console.log(`<font color=\"#DC00FF\">[Terminals]</font> Creating critical energy order for ${rmColony} for ${amount} energy.`);
					_.set(Memory, ["resources", "terminal_orders", `${rmColony}-energy_critical`], 
						{ room: rmColony, resource: "energy", amount: amount, automated: true, priority: 1 });
					
					// Prevent double energy orders (one for critical, one for regular stockpile)
					delete Memory["resources"]["terminal_orders"][`${rmColony}-energy`];
				}
			} else {
				delete Memory["resources"]["terminal_orders"][`${rmColony}-energy_critical`];
			}

			let filling = new Array();
			this.runTerminal_Orders(rmColony, storage, terminal, shortage, filling);
			this.runTerminal_Empty(rmColony, storage, terminal, filling);
        }
	},

	runTerminal_Orders: function (rmColony, storage, terminal, shortage, filling) {
		/* Priority list for terminal orders:
		 * 	1: console injected...
		 * 	2: filling a shortage (internal transfers)
		 * 	3: filling energy for an internal transfer
		 *	4: filling a market order
		 *	5: filling energy for a market order
		*/

		for (let o in _.get(Memory, ["resources", "terminal_orders"]))
			_.set(Memory, ["resources", "terminal_orders", o, "name"], o);

		let orders = _.sortBy(_.get(Memory, ["resources", "terminal_orders"]), "priority");

		for (let n in orders) {
			let order = orders[n];

			if (_.get(order, "active", true) == false)
				continue;

			if (this.runOrder_Sync(order, rmColony) == false)
				continue;

			if ((order["market_id"] == null && order["room"] != rmColony)
				|| (order["market_id"] != null && order["type"] == "buy" && order["from"] == rmColony)) {
				// Buy order means I'm selling...
				if (this.runOrder_Send(rmColony, order, storage, terminal, shortage, filling) == true)
					return;
			} else if (order["market_id"] != null && order["type"] == "sell" && order["to"] == rmColony) { 
				// Sell order means I'm buying...
				if (this.runOrder_Receive(rmColony, order, storage, terminal, filling) == true)
					return;
			}
		}
	},

	runOrder_Sync: function (order, rmColony) {
		let o = order["name"];

		if (_.get(order, "market_id") != null) {	// Sync market orders, update/find new if expired...
			if (order["sync"] != Game.time) {
				order["sync"] = Game.time;
				let sync = Game.market.getOrderById(order["market_id"]);

				if (sync != null) {
					order["market_item"] = sync;
					order["type"] = sync.type;
					order["room"] = sync.roomName;
					order["resource"] = sync.resourceType;
				} else {
					let replacement = _.head(_.sortBy(Game.market.getAllOrders(
						obj => { return _.get(obj, "resourceType") == _.get(order, ["market_item", "resourceType"])
							&& _.get(obj, "type") == _.get(order, ["market_item", "type"]) 
							&& _.get(obj, "price") == _.get(order, ["market_item", "price"]); }),
						obj => { return Game.map.getRoomLinearDistance(rmColony, obj.roomName); }));

					if (replacement != null) {
						order["market_item"] = replacement;
						order["market_id"] = replacement.id;
						order["type"] = replacement.type;
						order["room"] = replacement.roomName;
						order["resource"] = replacement.resourceType;

						console.log(`<font color=\"#00F0FF\">[Market]</font> Replacement market order found for ${o}!`);
						return true;
					} else {
						console.log(`<font color=\"#00F0FF\">[Market]</font> No replacement market order found for ${o}; order deleted!`);

						delete Memory["resources"]["terminal_orders"][o];
						return false;
					}
				}
			}
		}

		return true;
	},

	runOrder_Send: function (rmColony, order, storage, terminal, shortage, filling) {
		/* Notes: Minimum transfer amount is 100.
		 *	 Don't try fulfilling orders with near-shortages- can cause an endless send loop and confuse couriers
		*/

		let o = order["name"];
		let res = order["resource"];
		let room = Game.rooms[rmColony];

		if (_.get(shortage, res, 0) < -2000 || (!_.keys(shortage).includes(res) && room.store(res) > 100)) {
			if (terminal.store[res] != null && ((res != "energy" && terminal.store[res] >= 100) || (res == "energy" && terminal.store[res] > 200))) {
				filling.push(res);
				filling.push("energy");

				let amount;
				if (res == "energy") {
					let calc_transfer = Game.market.calcTransactionCost(10000, rmColony, order["room"]);
					let calc_total = calc_transfer + 10000;
					let calc_coeff = (1 - calc_transfer / calc_total) * 0.95;
					amount = Math.floor(Math.clamp(terminal.store[res] * calc_coeff, 100, order["amount"]));
				} else {
					amount = Math.floor(Math.clamp(terminal.store[res], 100, order["amount"]));
				}

				let cost = Game.market.calcTransactionCost(amount, rmColony, order["room"]);

				if ((res != "energy" && terminal.store["energy"] >= cost)
						|| (res == "energy" && terminal.store["energy"] >= cost + amount)) {

					if (terminal.cooldown > 0)
						return false;				

					let result = (order["market_id"] == null)
						? terminal.send(res, amount, order["room"])
						: Game.market.deal(order["market_id"], amount, rmColony);

					if (result == OK) {
						console.log(`<font color=\"#DC00FF\">[Terminals]</font> ${o}: ${amount} of ${res} sent, ${rmColony}`
							+ ` -> ${order["room"]}`);

						Memory["resources"]["terminal_orders"][o]["amount"] -= amount;
						if (_.get(Memory, ["resources", "terminal_orders", o, "amount"]) <= 0)
							delete Memory["resources"]["terminal_orders"][o];

						return true;

					} else {
						console.log(`<font color=\"#DC00FF\">[Terminals]</font> ${o}: failed to send, `
							+ `${amount} of ${res} ${rmColony} -> ${order["room"]} (code: ${result})`);
					}
				} else {
					if (storage != null && storage.store["energy"] > room.getCriticalEnergy()) {
						Memory.rooms[rmColony].industry.tasks.push(
							{ type: "withdraw", resource: "energy", id: storage.id, timer: 60, priority: 5 },
							{ type: "deposit", resource: "energy", id: terminal.id, timer: 60, priority: 5 });
					} else if (res != "energy") {
						shortage["energy"] = (shortage["energy"] == null) ? cost : shortage["energy"] + cost;
						_.set(Memory, ["resources", "terminal_orders", `${rmColony}-energy`],
							{ room: rmColony, resource: "energy", amount: cost, automated: true, priority: order["market_id"] == null ? 3 : 5 });
					}
				}
			} else if (storage != null && storage.store[res] != null) {
				filling.push(res);

				Memory.rooms[rmColony].industry.tasks.push(
					{ type: "withdraw", resource: res, id: storage.id, timer: 60, priority: 5,
					amount: Object.keys(shortage).includes(res) ? Math.abs(shortage[res] + 100) : null },
					{ type: "deposit", resource: res, id: terminal.id, timer: 60, priority: 5 });
			}
		}

		return false;
	},

	runOrder_Receive: function (rmColony, order, storage, terminal, filling) {
	/* Notes: Minimum transfer amount is 100
	 * And always buy in small amounts! ~500-2000
	 */

		let o = order["name"];
		let res = order["resource"];
		let room = Game.rooms[rmColony];
		let amount = Math.max(100, Math.min(_.get(Memory, ["resources", "terminal_orders", o, "amount"]), 2000));
		let cost = Game.market.calcTransactionCost(amount, rmColony, order["room"]);

		if (terminal.store["energy"] != null && terminal.store["energy"] > cost) {
			filling.push("energy");

			if (terminal.cooldown > 0)
				return false;

			let result = Game.market.deal(order["market_id"], amount, rmColony);

			if (result == OK) {
				console.log(`<font color=\"#DC00FF\">[Terminals]</font> ${o}: ${amount} of ${res} received, ${order["room"]}`
					+ ` -> ${rmColony} `);

				Memory["resources"]["terminal_orders"][o]["amount"] -= amount;
				if (_.get(Memory, ["resources", "terminal_orders", o, "amount"]) <= 0)
					delete Memory["resources"]["terminal_orders"][o];

				return true;
			} else {
				console.log(`<font color=\"#DC00FF\">[Terminals]</font> ${o}: failed to receive`
					+ ` ${amount} of ${res} ${order["room"]} -> ${rmColony} (code: ${result})`);
			}
		} else {
			if (storage != null && storage.store["energy"] > room.getCriticalEnergy()) {
				filling.push("energy");

				Memory.rooms[rmColony].industry.tasks.push(
					{ type: "withdraw", resource: "energy", id: storage.id, timer: 60, priority: 5 },				
					{ type: "deposit", resource: "energy", id: terminal.id, timer: 60, priority: 5 });
			} else if (res != "energy") {
				_.set(Memory, ["resources", "terminal_orders", `${rmColony}-energy`], 
					{ room: rmColony, resource: "energy", amount: cost, automated: true, priority: 5 });
			}
		}

		return false;
	},

	runTerminal_Empty: function (rmColony, storage, terminal, filling) {
		// Create generic tasks for emptying terminal's minerals to storage
		let resource_list = [
			"energy",
			"H", "O", "U", "L", "K", "Z", "X", "G",
			"OH", "ZK", "UL",
			"UH", "UO", "KH", "KO", "LH", "LO", "ZH", "ZO", "GH", "GO",
			"UH2O", "UHO2", "KH2O", "KHO2", "LH2O", "LHO2", "ZH2O", "ZHO2", "GH2O", "GHO2",
			"XUH2O", "XUHO2", "XKH2O", "XKHO2", "XLH2O", "XLHO2", "XZH2O", "XZHO2", "XGH2O", "XGHO2" ];

		for (let r in resource_list) {
			let res = resource_list[r];

			if (filling.includes(res)
				|| ((res != "energy" && terminal.store[res] == null) || (res == "energy" && terminal.store[res] == 0)))
				continue;

			Memory.rooms[rmColony].industry.tasks.push(
				{ type: "withdraw", resource: res, id: terminal.id, timer: 60, priority: 6 },
				{ type: "deposit", resource: res, id: storage.id, timer: 60, priority: 6 });
		}
	},

	runCreeps: function (rmColony, listCreeps) {
        _.each(listCreeps, creep => {
			if (creep.memory.role == "courier") {
				Roles.Courier(creep);
			}
        });
	}
};