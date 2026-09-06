import { Request, Response, NextFunction } from 'express';
import { memberService } from '../services/member.service.js';
import { addMemberSchema, updateMemberRoleSchema } from '../schemas/member.schema.js';

export const addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const input = addMemberSchema.parse(req.body);
    const member = await memberService.addMember(projectId, input);
    res.status(201).json(member);
  } catch (error) {
    next(error);
  }
};

export const getProjectMembers = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const members = await memberService.getProjectMembers(projectId);
    res.status(200).json(members);
  } catch (error) {
    next(error);
  }
};

export const updateMemberRole = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.params.userId as string;
    const input = updateMemberRoleSchema.parse(req.body);
    const member = await memberService.updateMemberRole(projectId, userId, input);
    res.status(200).json(member);
  } catch (error) {
    next(error);
  }
};

export const removeMember = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.params.userId as string;
    const result = await memberService.removeMember(projectId, userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
