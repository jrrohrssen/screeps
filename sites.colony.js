require("populations");

let _CPU = require("util.cpu");
let Hive = require("hive");

module.exports = {

	Run: function(rmColony) {

		_CPU.Start(rmColony, "Colony-init");
		listSpawnRooms = _.get(Memory, ["rooms", rmColony, "spawn_assist", "rooms"]);
		listSpawnRoute = _.get(Memory, ["rooms", rmColony, "spawn_assist", "list_route"]);
		popTarget = _.get(Memory, ["rooms", rmColony, "custom_population"]);

		if (_.get(Memory, ["rooms", rmColony, "defense", "threat_level"]) == null)
			_.set(Memory, ["rooms", rmColony, "defense", "threat_level"], MEDIUM);

		let listCreeps = _.filter(Game.creeps, c => c.memory.room == rmColony);
		_CPU.End(rmColony, "Colony-init");

		
		_CPU.Start(rmColony, "Colony-surveyRoom");
		if (isPulse_Defense()) {
			this.surveyRoom(rmColony);		
			this.surveySafeMode(rmColony, listCreeps);
		}
		_CPU.End(rmColony, "Colony-surveyRoom");

		if (isPulse_Spawn()) {
			_CPU.Start(rmColony, "Colony-runPopulation");
			this.runPopulation(rmColony, listCreeps, listSpawnRooms, popTarget);
			_CPU.End(rmColony, "Colony-runPopulation");
		}

		_CPU.Start(rmColony, "Colony-runCreeps");
		this.runCreeps(rmColony, listCreeps, listSpawnRoute);
        _CPU.End(rmColony, "Colony-runCreeps");

		_CPU.Start(rmColony, "Colony-runTowers");
		this.runTowers(rmColony);
        _CPU.End(rmColony, "Colony-runTowers");
		
		_CPU.Start(rmColony, "Colony-defineLinks");
		if (isPulse_Long() || _.has(Memory, ["hive", "pulses", "reset_links"])) {
			this.defineLinks(rmColony);
		}
		_CPU.End(rmColony, "Colony-defineLinks");

		_CPU.Start(rmColony, "Colony-runLinks");
		this.runLinks(rmColony);
        _CPU.End(rmColony, "Colony-runLinks");
	},

	surveyRoom: function(rmColony) {
		let visible = _.keys(Game.rooms).includes(rmColony);
		_.set(Memory, ["rooms", rmColony, "survey", "has_minerals"],
			visible ? Game.rooms[rmColony].find(FIND_MINERALS, {filter: (m) => { return m.mineralAmount > 0; }}).length > 0 : false);

		let hostiles = visible 
			? _.filter(Game.rooms[rmColony].find(FIND_HOSTILE_CREEPS), c => { return c.isHostile(); })
			: new Array();
		_.set(Memory, ["rooms", rmColony, "defense", "hostiles"], hostiles);
			
		let is_safe = !visible || hostiles.length == 0;
		_.set(Memory, ["rooms", rmColony, "defense", "is_safe"], is_safe);

		let storage = _.get(Game, ["rooms", rmColony, "storage"]);
		
		if (visible && storage != null && storage.store["energy"] < Game["rooms"][rmColony].getCriticalEnergy()) {
			_.set(Memory, ["rooms", rmColony, "survey", "energy_level"], CRITICAL);
		} else if (visible && storage != null && storage.store["energy"] < Game["rooms"][rmColony].getLowEnergy()) {
			_.set(Memory, ["rooms", rmColony, "survey", "energy_level"], LOW);
		} else if (visible && storage != null && storage.store["energy"] > Game["rooms"][rmColony].getExcessEnergy()) {
			_.set(Memory, ["rooms", rmColony, "survey", "energy_level"], EXCESS);
		} else {
			_.set(Memory, ["rooms", rmColony, "survey", "energy_level"], NORMAL);
		}

		let ticks_downgrade = _.get(Game, ["rooms", rmColony, "controller", "ticksToDowngrade"]);
		_.set(Memory, ["rooms", rmColony, "survey", "downgrade_critical"], (ticks_downgrade > 0 && ticks_downgrade < 3500))
	},

	surveySafeMode: function(rmColony, listCreeps) {
		let room = _.get(Game, ["rooms", rmColony]);
		let controller = _.get(room, "controller");
		let is_safe = _.get(Memory, ["rooms", rmColony, "defense", "is_safe"]);

		if (is_safe || room == null || controller == null || controller.safeMode > 0 
				|| controller.safeModeCooldown > 0 || controller.safeModeAvailable == 0)
			return;

		let hostiles = _.get(Memory, ["rooms", rmColony, "defense", "hostiles"]);
		let threats = _.filter(hostiles, c => { 
			return c.isHostile() && c.owner.username != "Invader" 
				&& (c.hasPart("attack") || c.hasPart("ranged_attack") || c.hasPart("work")); });
		let structures = _.filter(room.find(FIND_MY_STRUCTURES), s => {
			return s.structureType == "spawn" || s.structureType == "extension"
				|| s.structureType == "tower" || s.structureType == "nuker"
				|| s.structureType == "storage" || s.structureType == "terminal"; });

		for (let i = 0; i < structures.length; i++) {
			if (structures[i].pos.findInRange(threats, 3).length > 0) {
				if (room.controller.activateSafeMode() == OK)
					console.log(`<font color=\"#FF0000\">[Invasion]</font> Safe mode activated in ${rmColony}; enemy detected at key base structure!`);
				return;
			}
		}

		if (structures.length == 0) {
			for (let i = 0; i < listCreeps.length; i++) {
				if (listCreeps[i].pos.findInRange(threats, 3).length > 0) {
					if (room.controller.activateSafeMode() == OK)
						console.log(`<font color=\"#FF0000\">[Invasion]</font> Safe mode activated in ${rmColony}; no structures; enemy detected at creeps!`);
					return;
				}
			}
		}
	},

	runPopulation: function(rmColony, listCreeps, listSpawnRooms, populationTarget) {
		let room_level = Game["rooms"][rmColony].getLevel();
		let is_safe = _.get(Memory, ["rooms", rmColony, "defense", "is_safe"]);		
		let hostiles = _.get(Memory, ["rooms", rmColony, "defense", "hostiles"], new Array());
		let threat_level = _.get(Memory, ["rooms", rmColony, "defense", "threat_level"]);
		let energy_level = _.get(Memory, ["rooms", rmColony, "survey", "energy_level"]);
		let downgrade_critical = _.get(Memory, ["rooms", rmColony, "survey", "downgrade_critical"]);
		
		let popActual = new Object();
		_.each(listCreeps, c => {
			switch(_.get(c, ["memory", "role"])) {
				default: break;
				case "soldier": popActual["soldier"] = _.get(popActual, "soldier", 0) + 1; break;
				case "healer": popActual["healer"] = _.get(popActual, "healer", 0) + 1; break;
				case "worker": popActual["worker"] = _.get(popActual, "worker", 0) + 1; break;
			}
		});
		
		if (popTarget == null)
			popTarget = _.cloneDeep(Population_Colony[listSpawnRooms == null ? "Standalone" : "Assisted"][Math.max(1, room_level)]); 
		else
			popTarget = _.cloneDeep(populationTarget);
			
		// Adjust soldier amounts & levels based on threat level
		if (threat_level != NONE && _.get(Game, ["rooms", rmColony, "controller", "safeMode"]) == null) {						
			if (threat_level == LOW || threat_level == null) {
				_.set(popTarget, ["soldier", "amount"], _.get(popTarget, ["soldier", "amount"], 0) + 2);
				if (is_safe)
					_.set(popTarget, ["soldier", "level"], Math.max(2, room_level - 2));
			} else if (threat_level == MEDIUM) {
				_.set(popTarget, ["soldier", "amount"], _.get(popTarget, ["soldier", "amount"], 0) + 3);
				_.set(popTarget, ["healer", "amount"], _.get(popTarget, ["healer", "amount"], 0) + 1);
				if (is_safe) {
					_.set(popTarget, ["soldier", "level"], Math.max(2, room_level - 1));
					_.set(popTarget, ["healer", "level"], Math.max(2, room_level - 1));
				}
			} else if (threat_level == HIGH) {
				_.set(popTarget, ["soldier", "amount"], _.get(popTarget, ["soldier", "amount"], 0) + 6);
				_.set(popTarget, ["healer", "amount"], _.get(popTarget, ["healer", "amount"], 0) + 2);
			}				
		}

		// Adjust worker amounts based on is_safe, energy_level
		if (!is_safe) {
			_.set(popTarget, ["worker", "level"], Math.max(1, Math.round(_.get(popTarget, ["worker", "level"]) * 0.5)))
		} else if (is_safe) {
			if (energy_level == CRITICAL) {
				_.set(popTarget, ["worker", "amount"], Math.max(1, Math.round(_.get(popTarget, ["worker", "amount"]) * 0.33)))
				_.set(popTarget, ["worker", "level"], Math.max(1, Math.round(_.get(popTarget, ["worker", "level"]) * 0.33)))
			} else if (energy_level == LOW) {
				_.set(popTarget, ["worker", "amount"], Math.max(1, Math.round(_.get(popTarget, ["worker", "amount"]) * 0.5)))
				_.set(popTarget, ["worker", "level"], Math.max(1, Math.round(_.get(popTarget, ["worker", "level"]) * 0.5)))
			} else if (energy_level == EXCESS && room_level < 8) {
				let storage = _.get(Game, ["rooms", rmColony, "storage"]);
				_.set(popTarget, ["worker", "amount"], Math.round(_.get(popTarget, ["worker", "amount"]) * 
					(storage.store["energy"] / Math.max(1, Game["rooms"][rmColony].getLowEnergy())) * 0.75));
			}
		}
		
		// Tally population levels for level scaling and statistics
		Hive.populationTally(rmColony, 
			_.sum(popTarget, p => { return _.get(p, "amount", 0); }), 
			_.sum(popActual));
		
		if (_.get(Game, ["rooms", rmColony, "controller", "safeMode"]) == null
			&& ((_.get(popActual, "soldier", 0) < _.get(popTarget, ["soldier", "amount"], 0))
			|| (_.get(popActual, "soldier", 0) < hostiles.length))) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, 
					priority: (!is_safe ? 1 : 21),
					level: _.get(popTarget, ["soldier", "level"], room_level),
					scale: _.get(popTarget, ["soldier", "scale"], true),
					body: "soldier", name: null, args: {role: "soldier", room: rmColony} });
		} 
		
		if (_.get(Game, ["rooms", rmColony, "controller", "safeMode"]) == null
			&& _.get(popActual, "healer", 0) < _.get(popTarget, ["healer", "amount"], 0)) {
			Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, 
				priority: (!is_safe ? 2 : 22),
				level: _.get(popTarget, ["healer", "level"], 1),
				scale: _.get(popTarget, ["healer", "scale"], true),
				body: "healer", name: null, args: {role: "healer", room: rmColony} });
		} 
		
		if (_.get(popActual, "worker", 0) < _.get(popTarget, ["worker", "amount"], 0)) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, 
					priority: Math.lerpSpawnPriority(23, 25, _.get(popActual, "worker", 0), _.get(popTarget, ["worker", "amount"], 0)),
					level: _.get(popTarget, ["worker", "level"], 1),
					scale: _.get(popTarget, ["worker", "scale"], true),
					body: _.get(popTarget, ["worker", "body"], "worker"),
					name: null, args: {role: "worker", room: rmColony} });
		} 
	},


	runCreeps: function (rmColony, listCreeps, listSpawnRoute) {
		let Roles = require("roles");

		_.each(listCreeps, creep => {
			_.set(creep, ["memory", "list_route"], listSpawnRoute);

			if (creep.memory.role == "worker") {
				Roles.Worker(creep);
			} else if (creep.memory.role == "soldier") {
				Roles.Soldier(creep, false, true);
			} else if (creep.memory.role == "healer") {
				Roles.Healer(creep, false);
			}
        });
	},


	runTowers: function (rmColony) {
		let is_safe = (_.get(Memory, ["rooms", rmColony, "defense", "hostiles"], new Array()).length == 0);

		if (!is_safe) {
			_.set(Memory, ["rooms", rmColony, "defense", "targets", "heal"], null);
			_.set(Memory, ["rooms", rmColony, "defense", "targets", "repair"], null);
			
			this.towerAcquireAttack(rmColony);
			this.towerRunAttack(rmColony);
			return;
		} else {
		    _.set(Memory, ["rooms", rmColony, "defense", "targets", "attack"], null);
			
			this.towerAcquireHeal(rmColony);
			if (_.get(Memory, ["rooms", rmColony, "defense", "targets", "heal"]) != null) {
				this.towerRunHeal(rmColony);
				return;
			}

			this.towerAcquireRepair(rmColony);
			if (_.get(Memory, ["rooms", rmColony, "defense", "targets", "repair"]) != null) {
				this.towerRunRepair(rmColony);
				return;
			}
		}
	},

	towerAcquireAttack: function (rmColony) {
		let target = _.get(Memory, ["rooms", rmColony, "defense", "targets", "attack"]);

		// Check if existing target is still alive and in room... otherwise nullify and re-acquire
		if (target != null) {
			let hostile = Game.getObjectById(target);
			if (hostile == null) {
				target == null;
				_.set(Memory, ["rooms", rmColony, "defense", "targets", "attack"], null);
			}
		}
		
		// Acquire target if no target exists, or re-acquire target every 15 ticks
		if (target == null || Game.time % 15 == 0) {
			let base_structures = _.filter(Game.rooms[rmColony].find(FIND_STRUCTURES),
				s => { return s.structureType != "link" && s.structureType != "container" 
						&& s.structureType != "extractor" && s.structureType != "controller"
						&& s.structureType != "road"; });
			let spawns = _.filter(base_structures, s => { return s.structureType == "spawn"; });
			
			// Find the center of base by averaging position of all spawns
			let originX = 0, originY = 0;
			for (let i = 0; i < spawns.length; i++) {
				originX += spawns[i].pos.x; 
				originY += spawns[i].pos.y;
			}
			originX /= spawns.length;
			originY /= spawns.length;

			let my_creeps = Game.rooms[rmColony].find(FIND_MY_CREEPS);
			// Only attack creeps that are 1) not allies and 2) within 10 sq of base structures (or Invader within 5 sq of creeps)
			// Then sort by 1) if they have heal parts, and 2) sort by distance (attack closest)
			target = _.head(_.sortBy(_.filter(Game.rooms[rmColony].find(FIND_HOSTILE_CREEPS),
				c => { return !c.isAlly() && (c.pos.inRangeToListTargets(base_structures, 10) 
						|| (c.owner.username == "Invader" && c.pos.inRangeToListTargets(my_creeps, 3))); }),
				c => { return (c.hasPart("heal") > 0
					? -100 + new RoomPosition(originX, originY, rmColony).getRangeTo(c.pos.x, c.pos.y)
					: new RoomPosition(originX, originY, rmColony).getRangeTo(c.pos.x, c.pos.y)); }));
			_.set(Memory, ["rooms", rmColony, "defense", "targets", "attack"], _.get(target, "id"));
		}
	},

	towerRunAttack: function (rmColony) {
		let hostile_id = _.get(Memory, ["rooms", rmColony, "defense", "targets", "attack"]);
		if (hostile_id != null) {
			let hostile = Game.getObjectById(hostile_id);
			if (hostile == null) {
				_.set(Memory, ["rooms", rmColony, "defense", "targets", "attack"], null);
			} else {
				_.each(_.filter(Game.rooms[rmColony].find(FIND_MY_STRUCTURES), 
					s => { return s.structureType == "tower"; }),
					t => { t.attack(hostile); });				
			}
		}
	},

	towerAcquireHeal: function (rmColony) {
		if (Game.time % 15 == 0 && _.get(Game, ["rooms", rmColony]) != null) {
			let injured = _.head(_.filter(Game.rooms[rmColony].find(FIND_MY_CREEPS), 
				c => { return c.hits < c.hitsMax; }));
			_.set(Memory, ["rooms", rmColony, "defense", "targets", "heal"], _.get(injured, "id"));
		}
	},

	towerRunHeal: function (rmColony) {
		let injured_id = _.get(Memory, ["rooms", rmColony, "defense", "targets", "heal"]);
		if (injured_id != null) {
			let injured = Game.getObjectById(injured_id);
			if (injured == null || injured.hits == injured.hitsMax) {
				_.set(Memory, ["rooms", rmColony, "defense", "targets", "heal"], null);
			} else {
				_.each(Game.rooms[rmColony].find(FIND_MY_STRUCTURES, { filter: (s) => {
					return s.structureType == "tower" && s.energy > s.energyCapacity * 0.5; }}),
					t => { t.heal(injured) });				
			}
		}
	},

	towerAcquireRepair: function (rmColony) {
		let energy_level = _.get(Memory, ["rooms", rmColony, "survey", "energy_level"]);
		if (energy_level == CRITICAL) {
			_.set(Memory, ["rooms", rmColony, "defense", "targets", "repair"], null);
			return;
		}
		
		if (Game.time % 15 == 0 && _.get(Game, ["rooms", rmColony]) != null) {
			let room = Game["rooms"][rmColony];

			let repair = _.head(_.sortBy(_.filter(room.findRepair_Maintenance(), 
				r => { return (r.hits / room.getWallTarget() < 0.8
					&& (r.structureType == "rampart" || r.structureType == "constructedWall"
						|| r.structureType == "container" || r.structureType == "road")); }),					
				r => { 
					switch (r.structureType) {
						case "container":			return 1; 
						case "road":				return 2;
						case "rampart": 
						case "constructedWall":		return 3;
					}}));
					
			_.set(Memory, ["rooms", rmColony, "defense", "targets", "repair"], _.get(repair, "id"));
		}
	},

	towerRunRepair: function (rmColony) {
		let repair_id = _.get(Memory, ["rooms", rmColony, "defense", "targets", "repair"]);
		if (repair_id != null) {
			let repair = Game.getObjectById(repair_id);
			if (repair == null) {
				_.set(Memory, ["rooms", rmColony, "defense", "targets", "repair"], null);
			} else {
				_.each(Game.rooms[rmColony].find(FIND_MY_STRUCTURES, { filter: (s) => {
					return s.structureType == "tower" && s.energy > s.energyCapacity * 0.8; }}),
					t => { t.repair(repair) });				
			}
		}
	},

	defineLinks: function(rmColony) {
		let link_defs = _.get(Memory, ["rooms", rmColony, "links"]);
		let room = Game.rooms[rmColony];
		let structures = room.find(FIND_MY_STRUCTURES);
		let links = _.filter(structures, s => { return s.structureType == "link"; });
		
		// Check that link definitions are current with GameObject ID's
		if (link_defs != null && Object.keys(link_defs).length == links.length) {
			for (let i = 0; i < Object.keys(link_defs).length; i++) {
				if (_.filter(links, s => { return s.id == link_defs[i].id}).length == 0) {
					delete Memory["rooms"][rmColony]["links"];
				}
			}
		}

		// Define missing link definitions
		if (link_defs == null || Object.keys(link_defs).length != links.length) {
			link_defs = [];
			let sources = room.find(FIND_SOURCES);
			_.each(sources, source => { _.each(source.pos.findInRange(links, 2), link => {
				link_defs.push({id: link.id, dir: "send"});
			}); });

			_.each(_.filter(structures, s => { return s.structureType == "storage"; }), storage => {
				_.each(storage.pos.findInRange(links, 3), link => {
					link_defs.push({id: link.id, dir: "receive"});
				});
			});

			_.each(room.controller.pos.findInRange(links, 2), link => {
				link_defs.push({id: link.id, dir: "receive", role: "upgrade"});
			});

			Memory["rooms"][rmColony]["links"] = link_defs;
			console.log(`<font color=\"#D3FFA3\">[Console]</font> Links defined for ${rmColony}.`);
		}
		
	},

	runLinks: function (rmColony) {		
		let links = _.get(Memory, ["rooms", rmColony, "links"]);

		if (links != null) {
            let linksSend = _.filter(links, l => { return l["dir"] == "send"; });
            let linksReceive = _.filter(links, l => { return l["dir"] == "receive"; });

            _.each(linksReceive, r => {
				let receive = Game.getObjectById(r["id"]);
                _.each(linksSend, s => {
					if (receive != null) {
						let send = Game.getObjectById(s["id"]);
						if (send != null && send.energy > send.energyCapacity * 0.1 && receive.energy < receive.energyCapacity * 0.9) {
							send.transferEnergy(receive);
						}
					}
                });
            });
        }
	}
};
