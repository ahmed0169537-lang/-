import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { S3Service } from '../../common/services/s3.service';
import { UpdateProfileDto, UpdatePrivacyDto, UserSearchDto } from './dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private s3: S3Service,
  ) {}

  async getUserProfile(userId: string, currentUserId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            followers: true,
            following: true,
            posts: { where: { status: 'PUBLISHED' } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isBanned) {
      throw new ForbiddenException('This user has been banned');
    }

    // Check privacy
    if (user.privacyLevel === 'PRIVATE' && currentUserId !== userId) {
      const isFollowing = await this.isFollowing(currentUserId, userId);
      if (!isFollowing) {
        // Return limited profile info
        return this.getLimitedProfile(user);
      }
    }

    // Get follow status
    let isFollowing = false;
    if (currentUserId) {
      isFollowing = await this.isFollowing(currentUserId, userId);
    }

    return {
      ...user,
      isFollowing,
    };
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const { username, email, ...rest } = updateProfileDto;

    // Check if username is taken
    if (username) {
      const existingUser = await this.prisma.user.findUnique({
        where: { username },
      });
      if (existingUser && existingUser.id !== userId) {
        throw new ConflictException('Username is already taken');
      }
    }

    // Check if email is taken
    if (email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingUser && existingUser.id !== userId) {
        throw new ConflictException('Email is already taken');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        username,
        email,
        ...rest,
      },
    });

    return this.sanitizeUser(user);
  }

  async updatePrivacy(userId: string, updatePrivacyDto: UpdatePrivacyDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updatePrivacyDto,
    });

    return this.sanitizeUser(user);
  }

  async updateAvatar(userId: string, file: Express.Multer.File) {
    const url = await this.s3.uploadFile(file, `users/${userId}/avatar`);
    
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: url },
    });

    return { avatar: user.avatar };
  }

  async updateCover(userId: string, file: Express.Multer.File) {
    const url = await this.s3.uploadFile(file, `users/${userId}/cover`);
    
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { coverImage: url },
    });

    return { coverImage: user.coverImage };
  }

  async searchUsers(searchDto: UserSearchDto, currentUserId: string) {
    const { query, page = 1, limit = 20, filter } = searchDto;
    const skip = (page - 1) * limit;

    const where: any = {
      isActive: true,
      isBanned: false,
    };

    if (query) {
      where.OR = [
        { username: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (filter === 'followers') {
      where.followers = { some: { followerId: currentUserId } };
    } else if (filter === 'following') {
      where.following = { some: { followingId: currentUserId } };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          bio: true,
          _count: {
            select: {
              followers: true,
              following: true,
              posts: { where: { status: 'PUBLISHED' } },
            },
          },
        },
        orderBy: {
          followers: {
            _count: 'desc',
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Get follow status for each user
    const usersWithFollowStatus = await Promise.all(
      users.map(async (user) => {
        const isFollowing = await this.isFollowing(currentUserId, user.id);
        return { ...user, isFollowing };
      }),
    );

    return {
      users: usersWithFollowStatus,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async followUser(currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    if (targetUser.isBanned) {
      throw new ForbiddenException('Cannot follow a banned user');
    }

    // Check if already following
    const existingFollow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUserId,
          followingId: targetUserId,
        },
      },
    });

    if (existingFollow) {
      throw new ConflictException('Already following this user');
    }

    const follow = await this.prisma.follow.create({
      data: {
        followerId: currentUserId,
        followingId: targetUserId,
      },
    });

    // Create notification
    await this.prisma.notification.create({
      data: {
        userId: targetUserId,
        actorId: currentUserId,
        type: 'FOLLOW',
        content: 'started following you',
      },
    });

    // Invalidate cache
    await this.redis.del(`user:${targetUserId}:followers`);
    await this.redis.del(`user:${currentUserId}:following`);

    return { success: true };
  }

  async unfollowUser(currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestException('Cannot unfollow yourself');
    }

    const follow = await this.prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: currentUserId,
          followingId: targetUserId,
        },
      },
    });

    // Invalidate cache
    await this.redis.del(`user:${targetUserId}:followers`);
    await this.redis.del(`user:${currentUserId}:following`);

    return { success: true };
  }

  async getFollowStatus(currentUserId: string, targetUserId: string) {
    const isFollowing = await this.isFollowing(currentUserId, targetUserId);
    
    let isFollower = false;
    if (currentUserId !== targetUserId) {
      isFollower = await this.isFollowing(targetUserId, currentUserId);
    }

    return { isFollowing, isFollower };
  }

  async getUserSuggestions(userId: string, limit: number = 10) {
    // Get users not followed by the current user
    const followedUsers = await this.prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followedIds = followedUsers.map(f => f.followingId);
    followedIds.push(userId); // Exclude self

    const suggestions = await this.prisma.user.findMany({
      where: {
        id: { notIn: followedIds },
        isActive: true,
        isBanned: false,
        privacyLevel: 'PUBLIC',
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        bio: true,
        _count: {
          select: {
            followers: true,
          },
        },
      },
      orderBy: {
        followers: {
          _count: 'desc',
        },
      },
      take: limit,
    });

    // Get mutual followers count
    const suggestionsWithMutual = await Promise.all(
      suggestions.map(async (user) => {
        const mutualFollowers = await this.prisma.follow.count({
          where: {
            followerId: userId,
            followingId: {
              in: await this.prisma.follow.findMany({
                where: { followerId: user.id },
                select: { followingId: true },
              }).then(f => f.map(f => f.followingId)),
            },
          },
        });
        return { ...user, mutualFollowers };
      }),
    );

    return suggestionsWithMutual;
  }

  async deleteAccount(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new BadRequestException('Invalid password');
    }

    // Delete all user data
    await this.prisma.user.delete({
      where: { id: userId },
    });

    // Delete files from S3
    await this.s3.deleteFolder(`users/${userId}`);

    // Clear cache
    await this.redis.del(`user:${userId}`);
    await this.redis.del(`refresh:${userId}`);
    await this.redis.del(`session:${userId}`);

    return { success: true };
  }

  // Admin methods
  async getAllUsers(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              followers: true,
              following: true,
              posts: true,
              reports: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async banUser(userId: string, reason: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: true,
      },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'BAN_USER',
        entityType: 'User',
        entityId: userId,
        changes: { reason },
      },
    });

    // Clear sessions
    await this.redis.del(`refresh:${userId}`);
    await this.redis.del(`session:${userId}`);

    return { success: true };
  }

  async unbanUser(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: false,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'UNBAN_USER',
        entityType: 'User',
        entityId: userId,
      },
    });

    return { success: true };
  }

  async changeRole(userId: string, role: any) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'CHANGE_ROLE',
        entityType: 'User',
        entityId: userId,
        changes: { newRole: role },
      },
    });

    return this.sanitizeUser(user);
  }

  // Helper methods
  private async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });
    return !!follow;
  }

  private getLimitedProfile(user: any) {
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      bio: user.bio,
      _count: user._count,
      isPrivate: true,
    };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }
}
