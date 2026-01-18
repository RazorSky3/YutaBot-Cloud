import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'userData.json');

// JJK-themed rank configuration
const RANKS = {
  GRADE_4: {
    name: 'Grade 4 Sorcerer',
    roleId: '1049104030070231151',
    minLevel: 1,
    maxLevel: 20,
    minXP: 0,
    maxXP: 1000,
  },
  GRADE_3: {
    name: 'Grade 3 Sorcerer',
    roleId: '1078375784290467851',
    minLevel: 21,
    maxLevel: 50,
    minXP: 1001,
    maxXP: 5000,
  },
  SPECIAL_GRADE: {
    name: 'Special Grade Sorcerer',
    roleId: '1457874796594331855',
    minLevel: 51,
    maxLevel: Infinity,
    minXP: 5001,
    maxXP: Infinity,
  },
};

// XP Configuration
const XP_CONFIG = {
  MESSAGE: 5,
  REACTION: 2,
  VOICE_PER_30MIN: 10,
  DAILY_BONUS: 50,
  MESSAGE_COOLDOWN: 90000, // 1.5 minutes in milliseconds
  VOICE_INTERVAL: 1800000, // 30 minutes in milliseconds
};

class LevelingSystem {
  constructor() {
    this.userData = {};
    this.voiceSessions = new Map(); // Track active voice sessions
    this.init();
  }

  async init() {
    try {
      const data = await fs.readFile(DATA_FILE, 'utf-8');
      this.userData = JSON.parse(data);
      console.log('[LEVELING] User data loaded successfully');
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.userData = {};
        await this.saveData();
        console.log('[LEVELING] Created new user data file');
      } else {
        console.error('[LEVELING ERROR] Failed to load user data:', error);
      }
    }
  }

  async saveData() {
    try {
      await fs.writeFile(DATA_FILE, JSON.stringify(this.userData, null, 2));
    } catch (error) {
      console.error('[LEVELING ERROR] Failed to save user data:', error);
    }
  }

  getUser(userId) {
    if (!this.userData[userId]) {
      this.userData[userId] = {
        xp: 0,
        level: 1,
        lastMessage: 0,
        lastDailyBonus: 0,
        voiceTime: 0,
      };
    }
    return this.userData[userId];
  }

  calculateLevel(xp) {
    // Simple level calculation: every 50 XP = 1 level
    return Math.floor(xp / 50) + 1;
  }

  getRankByLevel(level) {
    if (level >= RANKS.SPECIAL_GRADE.minLevel) return RANKS.SPECIAL_GRADE;
    if (level >= RANKS.GRADE_3.minLevel) return RANKS.GRADE_3;
    return RANKS.GRADE_4;
  }

  getRankByXP(xp) {
    if (xp >= RANKS.SPECIAL_GRADE.minXP) return RANKS.SPECIAL_GRADE;
    if (xp >= RANKS.GRADE_3.minXP) return RANKS.GRADE_3;
    return RANKS.GRADE_4;
  }

  async addXP(userId, amount, reason = 'activity') {
    const user = this.getUser(userId);
    const oldLevel = user.level;
    const oldRank = this.getRankByLevel(oldLevel);

    user.xp += amount;
    user.level = this.calculateLevel(user.xp);

    await this.saveData();

    const newRank = this.getRankByLevel(user.level);
    const leveledUp = user.level > oldLevel;
    const rankedUp = newRank.roleId !== oldRank.roleId;

    console.log(`[LEVELING] ${userId} gained ${amount} XP (${reason}). Total: ${user.xp} XP, Level: ${user.level}`);

    return {
      leveledUp,
      rankedUp,
      oldLevel,
      newLevel: user.level,
      oldRank,
      newRank,
      totalXP: user.xp,
    };
  }

  async addMessageXP(userId) {
    const user = this.getUser(userId);
    const now = Date.now();

    // Check cooldown
    if (now - user.lastMessage < XP_CONFIG.MESSAGE_COOLDOWN) {
      return null;
    }

    user.lastMessage = now;
    return await this.addXP(userId, XP_CONFIG.MESSAGE, 'message');
  }

  async addReactionXP(userId) {
    return await this.addXP(userId, XP_CONFIG.REACTION, 'reaction');
  }

  async addDailyBonus(userId) {
    const user = this.getUser(userId);
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Check if 24 hours have passed
    if (now - user.lastDailyBonus < oneDayMs) {
      return null;
    }

    user.lastDailyBonus = now;
    return await this.addXP(userId, XP_CONFIG.DAILY_BONUS, 'daily bonus');
  }

  startVoiceSession(userId) {
    this.voiceSessions.set(userId, {
      startTime: Date.now(),
      lastXPTime: Date.now(),
    });
    console.log(`[LEVELING] Voice session started for ${userId}`);
  }

  async endVoiceSession(userId) {
    const session = this.voiceSessions.get(userId);
    if (!session) return null;

    const now = Date.now();
    const timeInVC = now - session.startTime;
    const intervals = Math.floor(timeInVC / XP_CONFIG.VOICE_INTERVAL);
    
    this.voiceSessions.delete(userId);

    if (intervals > 0) {
      const xpToAdd = intervals * XP_CONFIG.VOICE_PER_30MIN;
      console.log(`[LEVELING] Voice session ended for ${userId}. Time: ${Math.floor(timeInVC / 60000)} min, XP: ${xpToAdd}`);
      return await this.addXP(userId, xpToAdd, 'voice chat');
    }

    return null;
  }

  async checkVoiceXP(userId) {
    const session = this.voiceSessions.get(userId);
    if (!session) return null;

    const now = Date.now();
    const timeSinceLastXP = now - session.lastXPTime;

    if (timeSinceLastXP >= XP_CONFIG.VOICE_INTERVAL) {
      session.lastXPTime = now;
      return await this.addXP(userId, XP_CONFIG.VOICE_PER_30MIN, 'voice chat');
    }

    return null;
  }

  async updateUserRoles(member, newRank, oldRank) {
    try {
      const rolesToRemove = [
        RANKS.GRADE_4.roleId,
        RANKS.GRADE_3.roleId,
        RANKS.SPECIAL_GRADE.roleId,
      ].filter(roleId => roleId !== newRank.roleId);

      // Remove old rank roles
      for (const roleId of rolesToRemove) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
        }
      }

      // Add new rank role
      if (!member.roles.cache.has(newRank.roleId)) {
        await member.roles.add(newRank.roleId);
        console.log(`[LEVELING] Role updated for ${member.user.tag}: ${newRank.name}`);
      }

      return true;
    } catch (error) {
      console.error('[LEVELING ERROR] Failed to update roles:', error);
      return false;
    }
  }

  getUserStats(userId) {
    const user = this.getUser(userId);
    const rank = this.getRankByLevel(user.level);
    const nextRank = this.getNextRank(rank);
    
    return {
      xp: user.xp,
      level: user.level,
      rank: rank.name,
      nextRank: nextRank ? nextRank.name : 'Max Rank',
      xpToNextRank: nextRank ? nextRank.minXP - user.xp : 0,
    };
  }

  getNextRank(currentRank) {
    if (currentRank === RANKS.GRADE_4) return RANKS.GRADE_3;
    if (currentRank === RANKS.GRADE_3) return RANKS.SPECIAL_GRADE;
    return null;
  }

  getLeaderboard(limit = 10) {
    const sorted = Object.entries(this.userData)
      .sort(([, a], [, b]) => b.xp - a.xp)
      .slice(0, limit);

    return sorted.map(([userId, data]) => ({
      userId,
      xp: data.xp,
      level: data.level,
      rank: this.getRankByLevel(data.level).name,
    }));
  }
}

export default new LevelingSystem();
export { RANKS, XP_CONFIG };
