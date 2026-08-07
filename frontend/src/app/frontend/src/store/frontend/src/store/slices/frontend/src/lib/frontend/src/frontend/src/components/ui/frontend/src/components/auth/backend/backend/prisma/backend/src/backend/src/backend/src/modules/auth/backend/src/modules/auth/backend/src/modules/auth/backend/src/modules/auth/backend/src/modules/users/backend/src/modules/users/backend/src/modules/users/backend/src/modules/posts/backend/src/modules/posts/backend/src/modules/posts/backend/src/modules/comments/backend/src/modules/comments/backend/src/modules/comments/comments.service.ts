import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCommentDto, UpdateCommentDto, CommentQueryDto } from './dto';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private notificationsService: NotificationsService,
  ) {}

  async createComment(userId: string, createCommentDto: CreateCommentDto) {
    const { postId, content, parentId } = createCommentDto;

    // Check if post exists
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { userId: true, isPublic: true, status: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.status !== 'PUBLISHED') {
      throw new BadRequestException('Cannot comment on this post');
    }

    // Check if parent comment exists
    if (parentId) {
      const parent = await this.prisma.comment.findUnique({
        where: { id: parentId },
      });
      if (!parent) {
        throw new NotFoundException('Parent comment not found');
      }
    }

    const comment = await this.prisma.comment.create({
      data: {
        userId,
        postId,
        content,
        parentId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Increment comments count on post
    await this.prisma.post.update({
      where: { id: postId },
      data: { commentsCount: { increment: 1 } },
    });

    // Create notification for post owner
    if (userId !== post.userId) {
      await this.notificationsService.createNotification({
        userId: post.userId,
        actorId: userId,
        type: 'COMMENT',
        content: `commented on your post: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
        data: { postId, commentId: comment.id },
      });
    }

    // If replying to a comment, notify the parent comment owner
    if (parentId) {
      const parentComment = await this.prisma.comment.findUnique({
        where: { id: parentId },
        select: { userId: true },
      });

      if (parentComment && parentComment.userId !== userId && parentComment.userId !== post.userId) {
        await this.notificationsService.createNotification({
          userId: parentComment.userId,
          actorId: userId,
          type: 'COMMENT',
          content: `replied to your comment: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
          data: { postId, commentId: comment.id, parentId },
        });
      }
    }

    // Invalidate cache
    await this.redis.del(`comments:post:${postId}`);
    await this.redis.del(`post:${postId}`);

    return comment;
  }

  async getComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            likes: true,
            replies: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Check if user can view the post
    const post = await this.prisma.post.findUnique({
      where: { id: comment.postId },
      select: { isPublic: true, userId: true, status: true },
    });

    if (!post || post.status !== 'PUBLISHED') {
      throw new NotFoundException('Comment not available');
    }

    if (!post.isPublic && post.userId !== userId) {
      const isFollowing = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId: post.userId,
          },
        },
      });

      if (!isFollowing) {
        throw new ForbiddenException('You cannot view this comment');
      }
    }

    // Check if user liked the comment
    const isLiked = await this.prisma.commentLike.findUnique({
      where: {
        userId_commentId: {
          userId,
          commentId,
        },
      },
    });

    return {
      ...comment,
      isLiked: !!isLiked,
    };
  }

  async getPostComments(postId: string, userId: string, query: CommentQueryDto) {
    const { page = 1, limit = 20, sort = 'latest' } = query;
    const skip = (page - 1) * limit;

    // Check post exists and is accessible
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { isPublic: true, userId: true, status: true },
    });

    if (!post || post.status !== 'PUBLISHED') {
      throw new NotFoundException('Post not found');
    }

    if (!post.isPublic && post.userId !== userId) {
      const isFollowing = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId: post.userId,
          },
        },
      });

      if (!isFollowing) {
        throw new ForbiddenException('You cannot view comments on this post');
      }
    }

    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'popular') {
      orderBy = { likesCount: 'desc' };
    } else if (sort === 'oldest') {
      orderBy = { createdAt: 'asc' };
    }

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          postId,
          parentId: null,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          _count: {
            select: {
              likes: true,
              replies: true,
            },
          },
          replies: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
              _count: {
                select: {
                  likes: true,
                },
              },
            },
            take: 3,
            orderBy: { createdAt: 'asc' },
          },
        },
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.comment.count({
        where: {
          postId,
          parentId: null,
        },
      }),
    ]);

    // Check likes for each comment
    const commentsWithInteraction = await Promise.all(
      comments.map(async (comment) => {
        const isLiked = await this.prisma.commentLike.findUnique({
          where: {
            userId_commentId: {
              userId,
              commentId: comment.id,
            },
          },
        });

        // Check likes for replies
        const repliesWithInteraction = await Promise.all(
          comment.replies.map(async (reply) => {
            const isReplyLiked = await this.prisma.commentLike.findUnique({
              where: {
                userId_commentId: {
                  userId,
                  commentId: reply.id,
                },
              },
            });
            return {
              ...reply,
              isLiked: !!isReplyLiked,
            };
          }),
        );

        return {
          ...comment,
          isLiked: !!isLiked,
          replies: repliesWithInteraction,
        };
      }),
    );

    return {
      comments: commentsWithInteraction,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCommentReplies(commentId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [replies, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          parentId: commentId,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          _count: {
            select: {
              likes: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.comment.count({
        where: {
          parentId: commentId,
        },
      }),
    ]);

    return {
      replies,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateComment(commentId: string, userId: string, updateCommentDto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: updateCommentDto,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Invalidate cache
    await this.redis.del(`comments:post:${comment.postId}`);
    await this.redis.del(`comment:${commentId}`);

    return updated;
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        _count: {
          select: {
            replies: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Check if user owns the comment or the post
    const post = await this.prisma.post.findUnique({
      where: { id: comment.postId },
      select: { userId: true },
    });

    if (comment.userId !== userId && post?.userId !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    // Delete all replies if any
    if (comment._count.replies > 0) {
      await this.prisma.comment.deleteMany({
        where: { parentId: commentId },
      });
    }

    await this.prisma.comment.delete({
      where: { id: commentId },
    });

    // Decrement comments count
    await this.prisma.post.update({
      where: { id: comment.postId },
      data: { commentsCount: { decrement: 1 + comment._count.replies } },
    });

    // Invalidate cache
    await this.redis.del(`comments:post:${comment.postId}`);
    await this.redis.del(`comment:${commentId}`);

    return { success: true };
  }

  async likeComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const existingLike = await this.prisma.commentLike.findUnique({
      where: {
        userId_commentId: {
          userId,
          commentId,
        },
      },
    });

    if (existingLike) {
      throw new BadRequestException('Comment already liked');
    }

    await this.prisma.commentLike.create({
      data: {
        userId,
        commentId,
      },
    });

    // Increment likes count
    await this.prisma.comment.update({
      where: { id: commentId },
      data: { likesCount: { increment: 1 } },
    });

    // Create notification if not self
    if (userId !== comment.userId) {
      await this.notificationsService.createNotification({
        userId: comment.userId,
        actorId: userId,
        type: 'LIKE',
        content: 'liked your comment',
        data: { commentId },
      });
    }

    // Invalidate cache
    await this.redis.del(`comment:${commentId}`);

    return { success: true };
  }

  async unlikeComment(commentId: string, userId: string) {
    const like = await this.prisma.commentLike.findUnique({
      where: {
        userId_commentId: {
          userId,
          commentId,
        },
      },
    });

    if (!like) {
      throw new BadRequestException('Comment not liked');
    }

    await this.prisma.commentLike.delete({
      where: {
        userId_commentId: {
          userId,
          commentId,
        },
      },
    });

    // Decrement likes count
    await this.prisma.comment.update({
      where: { id: commentId },
      data: { likesCount: { decrement: 1 } },
    });

    // Invalidate cache
    await this.redis.del(`comment:${commentId}`);

    return { success: true };
  }

  // Admin methods
  async getReportedComments(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          reports: {
            some: {
              status: 'PENDING',
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          post: {
            select: {
              id: true,
              content: true,
            },
          },
          reports: {
            include: {
              reporter: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.comment.count({
        where: {
          reports: {
            some: {
              status: 'PENDING',
            },
          },
        },
      }),
    ]);

    return {
      comments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async adminDeleteComment(commentId: string, reason: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        _count: {
          select: {
            replies: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Delete all replies
    if (comment._count.replies > 0) {
      await this.prisma.comment.deleteMany({
        where: { parentId: commentId },
      });
    }

    await this.prisma.comment.delete({
      where: { id: commentId },
    });

    // Decrement comments count
    await this.prisma.post.update({
      where: { id: comment.postId },
      data: { commentsCount: { decrement: 1 + comment._count.replies } },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        userId: comment.userId,
        action: 'ADMIN_DELETE_COMMENT',
        entityType: 'Comment',
        entityId: commentId,
        changes: { reason },
      },
    });

    // Invalidate cache
    await this.redis.del(`comments:post:${comment.postId}`);
    await this.redis.del(`comment:${commentId}`);

    return { success: true };
  }
}
